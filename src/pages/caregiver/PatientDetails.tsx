import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { MapContainer } from '@/components/map/MapContainer';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { calculateDistance } from '@/utils/distance';
import {
  ArrowLeft,
  MapPin,
  AlertTriangle,
  CheckCircle,
  Clock,
  Save,
  Target,
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

export default function PatientDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [geofence, setGeofence] = useState<Geofence | null>(null);
  const [tempGeofence, setTempGeofence] = useState<Geofence | null>(null);
  const [latestLocation, setLatestLocation] = useState<Location | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const defaultCenter: [number, number] = [51.505, -0.09]; // London default

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
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
        }
      )
      .subscribe();

    const alertsChannel = supabase
      .channel(`patient-${id}-alerts`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alerts', filter: `patient_id=eq.${id}` },
        () => {
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(locationChannel);
      supabase.removeChannel(alertsChannel);
    };
  }, [id, navigate]);

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
        </div>

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
                onMapClick={handleMapClick}
                className="h-[400px] w-full rounded-lg"
              />

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
        </div>
      </div>
    </DashboardLayout>
  );
}
