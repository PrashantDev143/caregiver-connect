import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { MapContainer } from '@/components/map/MapContainer';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { calculateDistance } from '@/utils/distance';
import { useAlertVoice } from '@/hooks/useAlertVoice';
import {
  ArrowLeft,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Clock,
  Save,
  Target,
  Radio,
  Crosshair,
  Search,
} from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  email: string;
}

interface Geofence {
  home_lat: number;
  home_lng: number;
  radius: number;
}

interface Location {
  lat: number;
  lng: number;
  created_at: string;
}

interface Alert {
  id: string;
  status: string;
  message: string | null;
  created_at: string;
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening';

interface PillLog {
  id: string;
  medicine_id: string;
  time_of_day: TimeOfDay;
  verification_status: 'success' | 'failed';
  similarity_score: number;
  verified_at: string;
}

export default function PatientDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { playAlert } = useAlertVoice();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [tempGeofence, setTempGeofence] = useState<Geofence | null>(null);
  const [latestLocation, setLatestLocation] = useState<Location | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [patientStatus, setPatientStatus] = useState<'INSIDE' | 'OUTSIDE'>('INSIDE');
  const [removingPatient, setRemovingPatient] = useState(false);
  const [caregiverProfileId, setCaregiverProfileId] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [medicationSchedule, setMedicationSchedule] = useState<Record<TimeOfDay, boolean>>({
    morning: false,
    afternoon: false,
    evening: false,
  });
  const [recentPillLogs, setRecentPillLogs] = useState<PillLog[]>([]);

  const previousStatusRef = useRef<'INSIDE' | 'OUTSIDE'>('INSIDE');

  const defaultCenter: [number, number] = [51.505, -0.09]; // London default

  useEffect(() => {
    if (!id || !user) return;

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }

    const fetchData = async () => {
      const { data: caregiverData } = await supabase
        .from('caregivers')
        .select('id')
        .eq('user_id', user?.id)
        .single();

      if (caregiverData?.id) {
        setCaregiverProfileId(caregiverData.id);
      }

      // Fetch patient
      const { data: patientData } = await supabase
        .from('patients')
        .select('id, name, email')
        .eq('id', id)
        .single();

      if (!patientData) {
        navigate('/caregiver/patients');
        return;
      }

      setPatient(patientData);

      // Fetch geofence
      const { data: geofenceData } = await supabase
        .from('geofences')
        .select('home_lat, home_lng, radius')
        .eq('patient_id', id)
        .single();

      if (geofenceData) {
        setGeofence(geofenceData);
        setTempGeofence(geofenceData);
      }

      // Fetch latest location
      const { data: locationData } = await supabase
        .from('location_logs')
        .select('lat, lng, created_at')
        .eq('patient_id', id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (locationData?.[0]) {
        setLatestLocation(locationData[0]);
      }

      // Fetch alerts
      const { data: alertsData } = await supabase
        .from('alerts')
        .select('id, status, message, created_at')
        .eq('patient_id', id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (alertsData) {
        setAlerts(alertsData);
      }

      const { data: scheduleData } = await supabase
        .from('medication_schedule')
        .select('time_of_day, enabled')
        .eq('patient_id', id);

      if (scheduleData) {
        const next: Record<TimeOfDay, boolean> = {
          morning: false,
          afternoon: false,
          evening: false,
        };
        scheduleData.forEach((entry) => {
          const slot = entry.time_of_day as TimeOfDay;
          if (slot in next) next[slot] = Boolean(entry.enabled);
        });
        setMedicationSchedule(next);
      }

      const { data: logsData } = await supabase
        .from('pill_logs')
        .select('id, medicine_id, time_of_day, verification_status, similarity_score, verified_at')
        .eq('patient_id', id)
        .order('verified_at', { ascending: false })
        .limit(10);

      if (logsData) {
        setRecentPillLogs(logsData as PillLog[]);
      }

      setLoading(false);
    };

    fetchData();

    // Set up realtime subscriptions
    const locationChannel = supabase
      .channel(`patient-${id}-locations`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'location_logs', filter: `patient_id=eq.${id}` },
        (payload) => {
          setLatestLocation(payload.new as Location);
          setLastUpdateTime(new Date());
          toast({
            title: 'Location Updated',
            description: 'Patient location has been updated.',
            duration: 2000,
          });
        }
      )
      .subscribe((status) => {
        setIsRealtimeConnected(status === 'SUBSCRIBED');
      });

    const alertsChannel = supabase
      .channel(`patient-${id}-alerts`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alerts', filter: `patient_id=eq.${id}` },
        (payload) => {
          // Refetch alerts
          supabase
            .from('alerts')
            .select('id, status, message, created_at')
            .eq('patient_id', id)
            .order('created_at', { ascending: false })
            .limit(10)
            .then(({ data }) => {
              if (data) setAlerts(data);
            });
          
          // Show toast + browser notification + beep only on INSIDE -> OUTSIDE transition
          if (payload.eventType === 'INSERT' && (payload.new as Alert).status === 'active') {
            if (previousStatusRef.current === 'INSIDE') {
              toast({
                variant: 'destructive',
                title: '⚠️ Alert: Patient Left Safe Zone',
                description: 'The patient has moved outside their geofenced area.',
              });

              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('SafeZone Alert', {
                  body: 'Patient is outside their safe zone.',
                });
              }

              void playAlert('outside_zone', { cooldownMs: 5_000 });
            }
            setPatientStatus('OUTSIDE');
            previousStatusRef.current = 'OUTSIDE';
          }
        }
      )
      .subscribe();

    const scheduleChannel = supabase
      .channel(`patient-${id}-schedule`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'medication_schedule', filter: `patient_id=eq.${id}` },
        () => {
          supabase
            .from('medication_schedule')
            .select('time_of_day, enabled')
            .eq('patient_id', id)
            .then(({ data }) => {
              if (!data) return;
              const next: Record<TimeOfDay, boolean> = {
                morning: false,
                afternoon: false,
                evening: false,
              };
              data.forEach((entry) => {
                const slot = entry.time_of_day as TimeOfDay;
                if (slot in next) next[slot] = Boolean(entry.enabled);
              });
              setMedicationSchedule(next);
            });
        }
      )
      .subscribe();

    const pillLogsChannel = supabase
      .channel(`patient-${id}-pill-logs`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pill_logs', filter: `patient_id=eq.${id}` },
        (payload) => {
          const next = payload.new as PillLog;
          setRecentPillLogs((prev) => [next, ...prev].slice(0, 10));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(locationChannel);
      supabase.removeChannel(alertsChannel);
      supabase.removeChannel(scheduleChannel);
      supabase.removeChannel(pillLogsChannel);
    };
  }, [id, navigate, playAlert, toast, user]);


  useEffect(() => {
    if (!latestLocation || !geofence) return;

    const distance = calculateDistance(
      latestLocation.lat,
      latestLocation.lng,
      geofence.home_lat,
      geofence.home_lng
    );

    const nextStatus: 'INSIDE' | 'OUTSIDE' = distance <= geofence.radius ? 'INSIDE' : 'OUTSIDE';
    setPatientStatus(nextStatus);
    previousStatusRef.current = nextStatus;
  }, [latestLocation, geofence]);

  const handleMapClick = (lat: number, lng: number) => {
    setTempGeofence((prev) => ({
      home_lat: lat,
      home_lng: lng,
      radius: prev?.radius ?? 100,
    }));
  };

  const handleRadiusChange = (value: number[]) => {
    setTempGeofence((prev) => ({
      home_lat: prev?.home_lat ?? defaultCenter[0],
      home_lng: prev?.home_lng ?? defaultCenter[1],
      radius: value[0],
    }));
  };

  const handleSetSafeZoneFromLiveLocation = () => {
    if (!latestLocation) {
      toast({
        variant: 'destructive',
        title: 'No live location available',
        description: 'Wait for patient location updates, then try again.',
      });
      return;
    }

    setTempGeofence((prev) => ({
      home_lat: latestLocation.lat,
      home_lng: latestLocation.lng,
      radius: prev?.radius ?? geofence?.radius ?? 100,
    }));

    toast({
      title: 'Safe zone updated from live location',
      description: 'Click Save Geofence to persist this safe zone.',
    });
  };

  const handleSetSafeZoneFromAddress = async () => {
    if (!addressInput.trim()) {
      toast({
        variant: 'destructive',
        title: 'Address required',
        description: 'Enter an address to set the safe zone.',
      });
      return;
    }

    setResolvingAddress(true);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addressInput.trim())}`
      );

      if (!response.ok) {
        throw new Error('Failed to resolve address');
      }

      const data = (await response.json()) as Array<{ lat: string; lon: string }>;

      if (!data.length) {
        toast({
          variant: 'destructive',
          title: 'Address not found',
          description: 'Try a more specific address.',
        });
        return;
      }

      const lat = Number(data[0].lat);
      const lng = Number(data[0].lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast({
          variant: 'destructive',
          title: 'Invalid location result',
          description: 'Unable to use the entered address.',
        });
        return;
      }

      setTempGeofence((prev) => ({
        home_lat: lat,
        home_lng: lng,
        radius: prev?.radius ?? geofence?.radius ?? 100,
      }));

      toast({
        title: 'Address converted to coordinates',
        description: 'Click Save Geofence to persist this safe zone.',
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Unable to resolve address',
        description: 'Please try again in a moment.',
      });
    } finally {
      setResolvingAddress(false);
    }
  };

  const handleSaveGeofence = async () => {
    if (!tempGeofence || !id) return;

    setSaving(true);

    if (geofence) {
      // Update existing
      const { error } = await supabase
        .from('geofences')
        .update({
          home_lat: tempGeofence.home_lat,
          home_lng: tempGeofence.home_lng,
          radius: tempGeofence.radius,
        })
        .eq('patient_id', id);

      if (error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to update geofence.',
        });
        setSaving(false);
        return;
      }
    } else {
      // Create new
      const { error } = await supabase.from('geofences').insert({
        patient_id: id,
        home_lat: tempGeofence.home_lat,
        home_lng: tempGeofence.home_lng,
        radius: tempGeofence.radius,
      });

      if (error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to create geofence.',
        });
        setSaving(false);
        return;
      }
    }

    setGeofence(tempGeofence);
    toast({
      title: 'Geofence saved!',
      description: 'The safe zone has been updated.',
    });
    setSaving(false);
  };

  const handleDeletePatient = async () => {
    if (!patient || !user || removingPatient) return;

    const confirmed = window.confirm(
      `Remove ${patient.name} from your care? This will unassign the patient.`
    );
    if (!confirmed) return;

    setRemovingPatient(true);

    const { data: caregiverData, error: caregiverError } = await supabase
      .from('caregivers')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (caregiverError || !caregiverData) {
      toast({
        variant: 'destructive',
        title: 'Unable to verify caregiver',
        description: caregiverError?.message ?? 'Could not find your caregiver profile.',
      });
      setRemovingPatient(false);
      return;
    }

    const { data, error } = await supabase
      .from('patients')
      .update({ caregiver_id: null })
      .eq('id', patient.id)
      .eq('caregiver_id', caregiverData.id)
      .select('id')
      .maybeSingle();

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to remove patient',
        description: error.message,
      });
      setRemovingPatient(false);
      return;
    }

    if (!data) {
      toast({
        variant: 'destructive',
        title: 'Patient not removed',
        description: 'This patient is no longer assigned to your account.',
      });
      setRemovingPatient(false);
      return;
    }

    toast({
      title: 'Patient removed',
      description: `${patient.name} has been unassigned from your care.`,
    });
    navigate('/caregiver/patients');
  };

  const handleSaveMedicationSchedule = async () => {
    if (!id || !caregiverProfileId) return;
    setScheduleSaving(true);

    const payload = (['morning', 'afternoon', 'evening'] as TimeOfDay[]).map((slot) => ({
      caregiver_id: caregiverProfileId,
      patient_id: id,
      time_of_day: slot,
      enabled: medicationSchedule[slot],
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('medication_schedule')
      .upsert(payload, { onConflict: 'patient_id,time_of_day' });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Schedule update failed',
        description: error.message,
      });
      setScheduleSaving(false);
      return;
    }

    toast({
      title: 'Medication schedule updated',
      description: 'Patient schedule has been saved.',
    });
    setScheduleSaving(false);
  };

  const hasActiveAlert = alerts.some((a) => a.status === 'active');
  const distanceFromHome =
    latestLocation && geofence
      ? Math.round(
          calculateDistance(
            latestLocation.lat,
            latestLocation.lng,
            geofence.home_lat,
            geofence.home_lng
          )
        )
      : null;

  const mapCenter: [number, number] = tempGeofence
    ? [tempGeofence.home_lat, tempGeofence.home_lng]
    : geofence
    ? [geofence.home_lat, geofence.home_lng]
    : latestLocation
    ? [latestLocation.lat, latestLocation.lng]
    : defaultCenter;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-tight">{patient?.name}</h1>
            <p className="text-muted-foreground">{patient?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Realtime Connection Indicator */}
            <Badge 
              variant="outline" 
              className={`gap-1 text-xs ${isRealtimeConnected ? 'border-green-500 text-green-600' : 'border-muted text-muted-foreground'}`}
            >
              <Radio className={`h-3 w-3 ${isRealtimeConnected ? 'animate-pulse' : ''}`} />
              {isRealtimeConnected ? 'Live' : 'Connecting...'}
            </Badge>
            {hasActiveAlert ? (
              <Badge variant="destructive" className="gap-1 text-sm">
                <AlertTriangle className="h-4 w-4" />
                Outside Safe Zone
              </Badge>
            ) : geofence ? (
              <Badge variant="secondary" className="gap-1 bg-green-100 text-sm text-green-700">
                <CheckCircle className="h-4 w-4" />
                Safe
              </Badge>
            ) : null}
            <Button
              variant="destructive"
              onClick={() => {
                void handleDeletePatient();
              }}
              disabled={removingPatient}
            >
              {removingPatient ? 'Removing...' : 'Delete Patient'}
            </Button>
          </div>
        </div>

        {patientStatus === 'OUTSIDE' && (
          <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-destructive">
            <p className="text-sm font-semibold">Red Alert: Patient is outside the safe zone.</p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Map & Geofence Config */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Geofence Configuration
              </CardTitle>
              <CardDescription>
                Click on the map to set the home location, then adjust the safe zone radius
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <MapContainer
                center={mapCenter}
                marker={tempGeofence ? [tempGeofence.home_lat, tempGeofence.home_lng] : undefined}
                geofence={tempGeofence ? { lat: tempGeofence.home_lat, lng: tempGeofence.home_lng, radius: tempGeofence.radius } : undefined}
                patientLocation={latestLocation ?? undefined}
                patientStatus={patientStatus}
                onMapClick={handleMapClick}
                className="h-[400px] w-full rounded-lg"
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSetSafeZoneFromLiveLocation}
                  disabled={!latestLocation}
                  className="gap-2"
                >
                  <Crosshair className="h-4 w-4" />
                  Use Patient Live Location
                </Button>

                <div className="flex gap-2">
                  <Input
                    value={addressInput}
                    onChange={(e) => setAddressInput(e.target.value)}
                    placeholder="Enter address"
                    disabled={resolvingAddress}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSetSafeZoneFromAddress}
                    disabled={resolvingAddress}
                    className="gap-2"
                  >
                    <Search className="h-4 w-4" />
                    {resolvingAddress ? 'Finding...' : 'Use Address'}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label>Safe Zone Radius: {tempGeofence?.radius ?? 100} meters</Label>
                  <Slider
                    value={[tempGeofence?.radius ?? 100]}
                    onValueChange={handleRadiusChange}
                    min={50}
                    max={1000}
                    step={10}
                    className="w-full"
                  />
                </div>
                <Button
                  onClick={handleSaveGeofence}
                  disabled={saving || !tempGeofence}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Geofence'}
                </Button>
              </div>

              {!tempGeofence && (
                <p className="text-sm text-muted-foreground">
                  Click anywhere on the map to set the home location
                </p>
              )}
            </CardContent>
          </Card>

          {/* Location Info */}
          <Card>
            <CardHeader>
              <CardTitle>Medication Schedule</CardTitle>
              <CardDescription>Set medication times for this patient.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {(['morning', 'afternoon', 'evening'] as TimeOfDay[]).map((slot) => (
                  <Button
                    key={slot}
                    type="button"
                    variant={medicationSchedule[slot] ? 'default' : 'outline'}
                    onClick={() =>
                      setMedicationSchedule((prev) => ({
                        ...prev,
                        [slot]: !prev[slot],
                      }))
                    }
                  >
                    {slot}
                  </Button>
                ))}
              </div>
              <Button onClick={() => void handleSaveMedicationSchedule()} disabled={scheduleSaving || !caregiverProfileId}>
                {scheduleSaving ? 'Saving...' : 'Save Schedule'}
              </Button>
            </CardContent>
          </Card>

          {/* Location Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Current Location
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latestLocation ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Latitude</p>
                      <p className="font-mono text-sm">{latestLocation.lat.toFixed(6)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Longitude</p>
                      <p className="font-mono text-sm">{latestLocation.lng.toFixed(6)}</p>
                    </div>
                  </div>
                  {distanceFromHome !== null && (
                    <div>
                      <p className="text-sm text-muted-foreground">Distance from home</p>
                      <p className="text-lg font-semibold">
                        {distanceFromHome} meters
                        {geofence && distanceFromHome > geofence.radius && (
                          <span className="ml-2 text-destructive">(outside safe zone)</span>
                        )}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Last updated: {new Date(latestLocation.created_at).toLocaleString()}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No location data yet</p>
              )}
            </CardContent>
          </Card>

          {/* Alert History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Alert History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <p className="text-muted-foreground">No alerts recorded</p>
              ) : (
                <div className="space-y-3">
                  {alerts.slice(0, 5).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-start justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-start gap-2">
                        {alert.status === 'active' ? (
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                        ) : (
                          <CheckCircle className="mt-0.5 h-4 w-4 text-green-500" />
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {alert.status === 'active' ? 'Left safe zone' : 'Resolved'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(alert.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Badge variant={alert.status === 'active' ? 'destructive' : 'secondary'}>
                        {alert.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Pill Verification Activity</CardTitle>
              <CardDescription>Realtime verification updates for this patient.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentPillLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No verification logs yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentPillLogs.map((log) => (
                    <div key={log.id} className="rounded-md border p-2">
                      <p className="text-sm font-medium">
                        {log.medicine_id} | {log.time_of_day}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {log.verification_status} | score {Number(log.similarity_score).toFixed(3)}
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(log.verified_at).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
