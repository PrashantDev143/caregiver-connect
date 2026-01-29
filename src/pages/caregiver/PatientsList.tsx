import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { Users, AlertTriangle, CheckCircle, MapPin, UserPlus, ArrowRight, Search } from 'lucide-react';

interface Patient {
  id: string;
  name: string;
  email: string;
  hasGeofence: boolean;
  hasActiveAlert: boolean;
  created_at: string;
}

export default function PatientsList() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!user) return;

    const fetchPatients = async () => {
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

      // Get patients
      const { data: patientsData } = await supabase
        .from('patients')
        .select('id, name, email, created_at')
        .eq('caregiver_id', caregiverData.id)
        .order('created_at', { ascending: false });

      if (!patientsData) {
        setLoading(false);
        return;
      }

      // Enrich with geofence and alert info
      const enrichedPatients = await Promise.all(
        patientsData.map(async (patient) => {
          const { data: geofence } = await supabase
            .from('geofences')
            .select('id')
            .eq('patient_id', patient.id)
            .single();

          const { data: alerts } = await supabase
            .from('alerts')
            .select('id')
            .eq('patient_id', patient.id)
            .eq('status', 'active')
            .limit(1);

          return {
            ...patient,
            hasGeofence: !!geofence,
            hasActiveAlert: (alerts?.length ?? 0) > 0,
          };
        })
      );

      setPatients(enrichedPatients);
      setLoading(false);
    };

    fetchPatients();
  }, [user]);

  const filteredPatients = patients.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Patients</h1>
            <p className="text-muted-foreground">Manage all patients under your care</p>
          </div>
          <Button asChild>
            <Link to="/caregiver/patients/add">
              <UserPlus className="mr-2 h-4 w-4" />
              Add Patient
            </Link>
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search patients by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Patient Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filteredPatients.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="mb-4 h-12 w-12 text-muted-foreground/50" />
              {patients.length === 0 ? (
                <>
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
                </>
              ) : (
                <>
                  <p className="text-lg font-medium">No patients found</p>
                  <p className="text-sm text-muted-foreground">
                    Try adjusting your search query
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPatients.map((patient) => (
              <Card key={patient.id} className="transition-shadow hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <span className="text-lg font-semibold text-primary">
                          {patient.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <CardTitle className="text-base">{patient.name}</CardTitle>
                        <CardDescription className="text-xs">{patient.email}</CardDescription>
                      </div>
                    </div>
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
                        Setup
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Added {new Date(patient.created_at).toLocaleDateString()}
                  </p>
                  <Button asChild variant="outline" className="w-full">
                    <Link to={`/caregiver/patient/${patient.id}`}>
                      View Details
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
