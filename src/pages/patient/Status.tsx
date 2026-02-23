import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PatientMedicineVerification } from '@/components/medicine/PatientMedicineVerification';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';

export default function PatientStatus() {
  const { user } = useAuth();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchPatient = async () => {
      const { data: patientData } = await supabase
        .from('patients')
        .select('id')
        .eq('user_id', user.id)
        .single();

      setPatientId(patientData?.id ?? null);
      setLoading(false);
    };

    fetchPatient();
  }, [user]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 text-center text-2xl font-semibold sm:text-4xl">
          LOADING
        </div>
      </DashboardLayout>
    );
  }

  if (!patientId) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 text-center text-2xl font-semibold sm:text-4xl">
          SETTING UP ACCOUNT
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-4xl space-y-4 px-3 py-5 sm:space-y-5 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-white/75 px-4 py-4 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold tracking-[0.01em] text-slate-900 sm:text-3xl">Medication Verification</h1>
            <p className="text-base text-slate-700 sm:text-lg">Verify medicine clearly before taking it.</p>
          </div>
          <Button asChild variant="outline" className="h-11 w-full rounded-xl text-base sm:w-auto sm:text-lg">
            <Link to="/patient/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>

        <PatientMedicineVerification patientId={patientId} />
      </div>
    </DashboardLayout>
  );
}
