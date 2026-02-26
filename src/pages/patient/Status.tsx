import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PatientMedicineVerification } from '@/components/medicine/PatientMedicineVerification';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

const QUERY_TIMEOUT_MS = 7000;

type QueryResult = {
  error: { message?: string } | null;
};

const withQueryTimeout = async <T extends QueryResult>(
  query: PromiseLike<T>,
  timeoutMs = QUERY_TIMEOUT_MS
): Promise<T | null> => {
  const timeoutMarker = Symbol('query-timeout');
  let timeoutId: number | undefined;

  try {
    const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
      timeoutId = window.setTimeout(() => resolve(timeoutMarker), timeoutMs);
    });

    const result = await Promise.race([query, timeoutPromise]);
    if (result === timeoutMarker) return null;
    return result as T;
  } catch {
    return null;
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
};

export default function PatientStatus() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    let isActive = true;

    const ensurePatientRow = async () => {
      const displayName =
        (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
        user.email?.split('@')[0] ||
        'Patient';

      return withQueryTimeout(
        supabase
          .from('patients')
          .upsert(
            {
              user_id: user.id,
              name: displayName,
              email: user.email ?? '',
            },
            { onConflict: 'user_id' }
          )
          .select('id')
          .maybeSingle()
      );
    };

    const fetchPatient = async () => {
      try {
        const result = await withQueryTimeout(
          supabase
            .from('patients')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle()
        );
        if (!isActive) return;

        let resolvedPatient = result?.data ?? null;

        if (!resolvedPatient) {
          const created = await ensurePatientRow();
          if (!isActive) return;
          resolvedPatient = created?.data ?? null;

          if (!resolvedPatient && (result?.error || created?.error)) {
            toast({
              variant: 'destructive',
              title: 'Unable to load patient profile',
              description:
                created?.error?.message ??
                result?.error?.message ??
                'Please refresh and try again.',
            });
          }
        }

        setPatientId(resolvedPatient?.id ?? null);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchPatient();
    return () => {
      isActive = false;
    };
  }, [toast, user]);

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
