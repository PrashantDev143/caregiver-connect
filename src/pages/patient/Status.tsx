import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PatientMedicineVerification } from '@/components/medicine/PatientMedicineVerification';
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
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center text-center text-4xl font-semibold">
          LOADING
        </div>
      </DashboardLayout>
    );
  }

  if (!patientId) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center text-center text-4xl font-semibold">
          SETTING UP ACCOUNT
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PatientMedicineVerification patientId={patientId} />
    </DashboardLayout>
  );
}
