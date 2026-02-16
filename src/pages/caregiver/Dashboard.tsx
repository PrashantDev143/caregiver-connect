import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { CaregiverMedicineUploader } from '@/components/medicine/CaregiverMedicineUploader';
import { Users, AlertTriangle, CheckCircle, MapPin, UserPlus, ArrowRight, Radio } from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  email: string;
  hasGeofence: boolean;
  latestLocation?: { lat: number; lng: number; created_at: string };
  hasActiveAlert: boolean;
}

export default function CaregiverDashboard() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const channelsRef = useRef<{ alerts: ReturnType<typeof supabase.channel>; locations: ReturnType<typeof supabase.channel> } | null>(null);
  const previousActiveAlertsRef = useRef<number | null>(null);
  const alertBeepRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!user) return;

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }

    if (!alertBeepRef.current) {
      alertBeepRef.current = new Audio(
        'data:audio/wav;base64,UklGRlQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YTAAAAAAABEREQAAERERAAAREREAABEREQAAERERAAAREREAABEREQAAERERAAAREREA'
      );
    }

    let attempts = 0;
    const maxAttempts = 5;
    const delayMs = 600;

    const fetchData = async (): Promise<void> => {
      const { data: caregiverData, error: caregiverError } = await supabase
        .from('caregivers')
        .select('id')
        .eq('user_id', user.id)
        .single();

      console.log('[CaregiverDashboard] caregivers fetch:', { data: caregiverData != null, error: caregiverError?.message ?? null });

      if (caregiverError) {
        console.error('[CaregiverDashboard] caregivers fetch failed:', caregiverError);
      }

      if (!caregiverData) {
        if (attempts < maxAttempts) {
          attempts++;
          await new Promise((r) => setTimeout(r, delayMs));
          return await fetchData();
        }
        console.warn('[CaregiverDashboard] caregiver row not found after retries, user_id=', user.id);
        setPatients([]);
        setLoading(false);
        return;
      }

      setCaregiverId(caregiverData.id);
      console.log('[CaregiverDashboard] caregiver_id resolved:', caregiverData.id);

      const { data: patientsData, error: patientsError } = await supabase
        .from('patients')
        .select('id, name, email')
        .eq('caregiver_id', caregiverData.id);

      console.log('[CaregiverDashboard] patients fetch:', { count: patientsData?.length ?? 0, error: patientsError?.message ?? null });

      if (patientsError) {
        console.error('[CaregiverDashboard] patients fetch failed:', patientsError);
        setPatients([]);
        setLoading(false);
        return;
      }

      const list = patientsData ?? [];
      if (list.length === 0) {
        setPatients([]);
        setLoading(false);
        return;
      }

      const enrichedPatients = await Promise.all(
        list.map(async (patient) => {
          const { data: geofence, error: geofenceErr } = await supabase
            .from('geofences')
            .select('id')
            .eq('patient_id', patient.id)
            .single();

          if (geofenceErr) console.log('[CaregiverDashboard] geofence for', patient.id, geofenceErr.message);

          const { data: locations, error: locErr } = await supabase
            .from('location_logs')
            .select('lat, lng, created_at')
            .eq('patient_id', patient.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (locErr) console.log('[CaregiverDashboard] location_logs for', patient.id, locErr.message);

          const { data: alerts, error: alertsErr } = await supabase
            .from('alerts')
            .select('id')
            .eq('patient_id', patient.id)
            .eq('status', 'active')
            .limit(1);

          if (alertsErr) console.log('[CaregiverDashboard] alerts for', patient.id, alertsErr.message);

          return {
            ...patient,
            hasGeofence: !!geofence,
            latestLocation: locations?.[0],
            hasActiveAlert: (alerts?.length ?? 0) > 0,
          };
        })
      );

      setPatients(enrichedPatients);
      setLoading(false);
    };

    fetchData();

    if (channelsRef.current) {
      supabase.removeChannel(channelsRef.current.alerts);
      supabase.removeChannel(channelsRef.current.locations);
      channelsRef.current = null;
    }

    const alertsChannel = supabase
      .channel('caregiver-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        fetchData();
      })
      .subscribe((status) => {
        console.log('[CaregiverDashboard] alerts channel:', status);
        setIsRealtimeConnected((prev) => prev || status === 'SUBSCRIBED');
      });

    const locationsChannel = supabase
      .channel('caregiver-locations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'location_logs' }, () => {
        fetchData();
      })
      .subscribe((status) => {
        console.log('[CaregiverDashboard] location_logs channel:', status);
        setIsRealtimeConnected((prev) => prev || status === 'SUBSCRIBED');
      });

    channelsRef.current = { alerts: alertsChannel, locations: locationsChannel };

    return () => {
      if (channelsRef.current) {
        supabase.removeChannel(channelsRef.current.alerts);
        supabase.removeChannel(channelsRef.current.locations);
        channelsRef.current = null;
      }
    };
  }, [user]);


  const activeAlerts = patients.filter((p) => p.hasActiveAlert).length;
  const safePatients = patients.filter((p) => !p.hasActiveAlert && p.hasGeofence).length;

  useEffect(() => {
    const previous = previousActiveAlertsRef.current;
    if (previous === null) {
      previousActiveAlertsRef.current = activeAlerts;
      return;
    }

    if (activeAlerts > previous) {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('SafeZone Alert', {
          body: 'A patient has moved outside their safe zone.',
        });
      }

      alertBeepRef.current
        ?.play()
        .catch(() => undefined);
    }

    previousActiveAlertsRef.current = activeAlerts;
  }, [activeAlerts]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
              <Badge
                variant="outline"
                className={`gap-1 text-xs ${isRealtimeConnected ? 'border-green-500 text-green-600' : 'border-muted text-muted-foreground'}`}
              >
                <Radio className={`h-3 w-3 ${isRealtimeConnected ? 'animate-pulse' : ''}`} />
                {isRealtimeConnected ? 'Live' : 'Connecting…'}
              </Badge>
            </div>
            <p className="text-muted-foreground">Monitor your patients&apos; safety in real-time</p>
          </div>
          <Button asChild>
            <Link to="/caregiver/patients/add">
              <UserPlus className="mr-2 h-4 w-4" />
              Add Patient
            </Link>
          </Button>
        </div>

        {activeAlerts > 0 && (
          <div className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-destructive">
            <p className="text-sm font-semibold">Red Alert: One or more patients are outside the safe zone.</p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Patients</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{patients.length}</div>
              <p className="text-xs text-muted-foreground">Under your care</p>
            </CardContent>
          </Card>
          <Card className={activeAlerts > 0 ? 'border-destructive bg-destructive/5' : ''}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
              <AlertTriangle className={`h-4 w-4 ${activeAlerts > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${activeAlerts > 0 ? 'text-destructive' : ''}`}>{activeAlerts}</div>
              <p className="text-xs text-muted-foreground">Patients outside safe zone</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Safe Patients</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{safePatients}</div>
              <p className="text-xs text-muted-foreground">Within safe zones</p>
            </CardContent>
          </Card>
        </div>

        <CaregiverMedicineUploader caregiverId={caregiverId} patients={patients} />

        <Card>
          <CardHeader>
            <CardTitle>Your Patients</CardTitle>
            <CardDescription>Quick overview of all patients under your care</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col items-center justify-center py-8 gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-muted-foreground">Loading patients…</p>
              </div>
            ) : patients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="mb-4 h-12 w-12 text-muted-foreground/50" />
                <p className="text-lg font-medium">No patients yet</p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Add your first patient to start monitoring their safety. Patients must be assigned to you from the Add Patient flow.
                </p>
                <Button asChild>
                  <Link to="/caregiver/patients/add">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add Patient
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {patients.map((patient) => (
                  <Link
                    key={patient.id}
                    to={`/caregiver/patient/${patient.id}`}
                    className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <span className="text-lg font-semibold text-primary">{patient.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div>
                        <p className="font-medium">{patient.name}</p>
                        <p className="text-sm text-muted-foreground">{patient.email}</p>
                        {!patient.latestLocation && (
                          <p className="text-xs text-muted-foreground mt-1">No location yet</p>
                        )}
                        {patient.latestLocation && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Last seen {new Date(patient.latestLocation.created_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {patient.hasActiveAlert ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Alert
                        </Badge>
                      ) : patient.hasGeofence ? (
                        <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700">
                          <CheckCircle className="h-3 w-3" />
                          Safe
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <MapPin className="h-3 w-3" />
                          No Geofence
                        </Badge>
                      )}
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
