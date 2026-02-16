import { useEffect, useState } from 'react';
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
  const [isSearching, setIsSearching] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [foundPatient, setFoundPatient] = useState<{ id: string; name: string; email: string } | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const loadCaregiverId = async () => {
      if (!user) return;

      const { data, error } = await supabase
        .from('caregivers')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (error || !data) {
        toast({
          variant: 'destructive',
          title: 'Caregiver profile missing',
          description: error?.message ?? 'Could not load your caregiver profile.',
        });
        return;
      }

      setCaregiverId(data.id);
    };

    void loadCaregiverId();
  }, [user, toast]);

  const handleSearch = async () => {
    if (!email.trim()) return;

    setIsSearching(true);
    setSearched(true);

    const { data: patient, error } = await supabase
      .from('patients')
      .select('id, name, email, caregiver_id')
      .eq('email', email.trim().toLowerCase())
      .is('caregiver_id', null)
      .maybeSingle();

    if (error || !patient) {
      if (error) {
        toast({
          variant: 'destructive',
          title: 'Search failed',
          description: error.message,
        });
      }
      setFoundPatient(null);
      setIsSearching(false);
      return;
    }

    setFoundPatient(patient);
    setIsSearching(false);
  };

  const handleAddPatient = async () => {
    if (!foundPatient || !caregiverId) return;

    setIsAssigning(true);

    const { data, error } = await supabase
      .from('patients')
      .update({ caregiver_id: caregiverId })
      .eq('id', foundPatient.id)
      .is('caregiver_id', null)
      .select('id')
      .maybeSingle();

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to add patient',
        description: error.message,
      });
      setIsAssigning(false);
      return;
    }

    if (!data) {
      toast({
        variant: 'destructive',
        title: 'Patient already assigned',
        description: 'This patient is no longer unassigned. Refresh and try again.',
      });
      setIsAssigning(false);
      return;
    }

    toast({
      title: 'Patient added!',
      description: `${foundPatient.name} is now under your care.`,
    });

    setIsAssigning(false);
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
                    disabled={isSearching || isAssigning}
                  />
                </div>
              </div>
              <Button onClick={handleSearch} disabled={isSearching || isAssigning || !email.trim()}>
                {isSearching ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Search Results */}
            {searched && !foundPatient && !isSearching && (
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
                  <Button onClick={handleAddPatient} disabled={isAssigning || isSearching || !caregiverId}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    {isAssigning ? 'Adding...' : 'Add to My Patients'}
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
