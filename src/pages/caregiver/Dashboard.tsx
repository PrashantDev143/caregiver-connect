import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { Users, AlertTriangle, CheckCircle, MapPin, UserPlus, ArrowRight } from 'lucide-react';

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

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      // Get caregiver ID
      const { data: caregiverData } = await supabase
        .from('caregivers')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!caregiverData) {
        setLoading(false);
        return;
      }

      setCaregiverId(caregiverData.id);

      // Get patients with their data
      const { data: patientsData } = await supabase
        .from('patients')
        .select('id, name, email')
        .eq('caregiver_id', caregiverData.id);

      if (!patientsData) {
        setLoading(false);
        return;
      }

      // Get additional data for each patient
      const enrichedPatients = await Promise.all(
        patientsData.map(async (patient) => {
          // Check for geofence
          const { data: geofence } = await supabase
            .from('geofences')
            .select('id')
            .eq('patient_id', patient.id)
            .single();

          // Get latest location
          const { data: locations } = await supabase
            .from('location_logs')
            .select('lat, lng, created_at')
            .eq('patient_id', patient.id)
            .order('created_at', { ascending: false })
            .limit(1);

          // Check for active alerts
          const { data: alerts } = await supabase
            .from('alerts')
            .select('id')
            .eq('patient_id', patient.id)
            .eq('status', 'active')
            .limit(1);

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

    // Set up realtime subscription for alerts
    const alertsChannel = supabase
      .channel('caregiver-alerts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alerts' },
        () => {
          fetchData(); // Refresh data on alert changes
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(alertsChannel);
    };
  }, [user]);

  const activeAlerts = patients.filter((p) => p.hasActiveAlert).length;
  const safePatients = patients.filter((p) => !p.hasActiveAlert && p.hasGeofence).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">Monitor your patients' safety in real-time</p>
          </div>
          <Button asChild>
            <Link to="/caregiver/patients/add">
              <UserPlus className="mr-2 h-4 w-4" />
              Add Patient
            </Link>
          </Button>
        </div>

        {/* Stats Cards */}
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
              <div className={`text-2xl font-bold ${activeAlerts > 0 ? 'text-destructive' : ''}`}>
                {activeAlerts}
              </div>
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

        {/* Patient List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Patients</CardTitle>
            <CardDescription>Quick overview of all patients under your care</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : patients.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="mb-4 h-12 w-12 text-muted-foreground/50" />
                <p className="text-lg font-medium">No patients yet</p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Add your first patient to start monitoring their safety
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
                        <span className="text-lg font-semibold text-primary">
                          {patient.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium">{patient.name}</p>
                        <p className="text-sm text-muted-foreground">{patient.email}</p>
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
