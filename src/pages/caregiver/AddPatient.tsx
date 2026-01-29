import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, ArrowLeft, Mail, Search } from 'lucide-react';

export default function AddPatient() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [foundPatient, setFoundPatient] = useState<{ id: string; name: string; email: string } | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!email.trim()) return;

    setIsLoading(true);
    setSearched(true);

    // Find patient by email
    const { data: patient, error } = await supabase
      .from('patients')
      .select('id, name, email, caregiver_id')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (error || !patient) {
      setFoundPatient(null);
      setIsLoading(false);
      return;
    }

    if (patient.caregiver_id) {
      toast({
        variant: 'destructive',
        title: 'Patient already assigned',
        description: 'This patient is already under another caregiver.',
      });
      setFoundPatient(null);
      setIsLoading(false);
      return;
    }

    setFoundPatient(patient);
    setIsLoading(false);
  };

  const handleAddPatient = async () => {
    if (!foundPatient || !user) return;

    setIsLoading(true);

    // Get caregiver ID
    const { data: caregiverData } = await supabase
      .from('caregivers')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (!caregiverData) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not find your caregiver profile.',
      });
      setIsLoading(false);
      return;
    }

    // Update patient's caregiver_id
    const { error } = await supabase
      .from('patients')
      .update({ caregiver_id: caregiverData.id })
      .eq('id', foundPatient.id);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add patient. Please try again.',
      });
      setIsLoading(false);
      return;
    }

    toast({
      title: 'Patient added!',
      description: `${foundPatient.name} is now under your care.`,
    });

    navigate('/caregiver/patients');
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Back Button */}
        <Button variant="ghost" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add Patient</h1>
          <p className="text-muted-foreground">Search for a registered patient by their email address</p>
        </div>

        {/* Search Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Find Patient
            </CardTitle>
            <CardDescription>
              Enter the email address the patient used to register
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="email" className="sr-only">
                  Patient Email
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="patient@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setSearched(false);
                      setFoundPatient(null);
                    }}
                    className="pl-10"
                    disabled={isLoading}
                  />
                </div>
              </div>
              <Button onClick={handleSearch} disabled={isLoading || !email.trim()}>
                {isLoading ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Search Results */}
            {searched && !foundPatient && !isLoading && (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="font-medium text-muted-foreground">No patient found</p>
                <p className="text-sm text-muted-foreground">
                  Make sure the email is correct and the patient has registered
                </p>
              </div>
            )}

            {foundPatient && (
              <div className="rounded-lg border bg-green-50 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                      <span className="text-lg font-semibold text-green-700">
                        {foundPatient.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium">{foundPatient.name}</p>
                      <p className="text-sm text-muted-foreground">{foundPatient.email}</p>
                    </div>
                  </div>
                  <Button onClick={handleAddPatient} disabled={isLoading}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    {isLoading ? 'Adding...' : 'Add to My Patients'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="border-dashed">
          <CardContent className="pt-6">
            <h3 className="mb-2 font-medium">How it works</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• Patients must first create their own account as a "Patient"</li>
              <li>• Search for them using the email they registered with</li>
              <li>• Once added, you can set up their geofence and monitor their location</li>
              <li>• Patients can only be assigned to one caregiver at a time</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
