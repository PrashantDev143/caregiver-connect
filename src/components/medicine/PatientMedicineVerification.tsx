import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MAX_ATTEMPTS = 10;

interface PatientMedicineVerificationProps {
  patientId: string | null;
}

interface CompareResponse {
  similarity_score: number;
  match: boolean;
  attempts_used: number;
  attempts_remaining: number;
  approved: boolean;
}

export function PatientMedicineVerification({ patientId }: PatientMedicineVerificationProps) {
  const [medicineId, setMedicineId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('TAKE MEDICINE PHOTO');

  const backendUrl = useMemo(
    () => import.meta.env.VITE_MEDICINE_BACKEND_URL || 'http://localhost:8000',
    []
  );

  useEffect(() => {
    if (!patientId) return;
    supabase
      .from('patients')
      .select('caregiver_id')
      .eq('id', patientId)
      .single()
      .then(({ data }) => setCaregiverId(data?.caregiver_id ?? null));
  }, [patientId]);

  useEffect(() => {
    if (!patientId || !medicineId) return;
    fetchAttemptsUsed();
  }, [patientId, medicineId]);

  useEffect(() => {
    setMessage('TAKE MEDICINE PHOTO');
  }, [medicineId]);

  useEffect(() => {
    if (attemptsUsed >= MAX_ATTEMPTS) {
      setMessage('CONTACT CAREGIVER');
    }
  }, [attemptsUsed]);

  const fetchAttemptsUsed = async () => {
    if (!patientId || !medicineId) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await supabase
      .from('medicine_verification_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .eq('medicine_id', medicineId)
      .eq('attempt_date', today);
    const resolvedCount = count ?? 0;
    setAttemptsUsed(resolvedCount);
    return resolvedCount;
  };

  const fetchReferenceUrl = async () => {
    if (!patientId || !caregiverId || !medicineId) return null;
    const referencePath = `caregiver/${caregiverId}/${patientId}/${medicineId}/reference`;
    const { data: referenceList } = await supabase.storage
      .from('medicine-images')
      .list(referencePath, { limit: 1, sortBy: { column: 'created_at', order: 'desc' } });

    const latest = referenceList?.[0];
    if (!latest) return null;
    const { data: signedReference } = await supabase.storage
      .from('medicine-images')
      .createSignedUrl(`${referencePath}/${latest.name}`, 60);
    return signedReference?.signedUrl ?? null;
  };

  const handleVerify = async () => {
    if (!patientId || !medicineId || !file) return;

    setLoading(true);
    const attempts = await fetchAttemptsUsed();
    if (attempts >= MAX_ATTEMPTS) {
      setMessage('CONTACT CAREGIVER');
      setLoading(false);
      return;
    }

    const referenceUrl = await fetchReferenceUrl();
    if (!referenceUrl) {
      setMessage('CONTACT CAREGIVER');
      setLoading(false);
      return;
    }

    const safeName = file.name.replace(/\s+/g, '-');
    const attemptPath = `patient/${patientId}/${medicineId}/attempts/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from('medicine-images')
      .upload(attemptPath, file, { upsert: false, contentType: file.type });

    if (uploadError) {
      setMessage('TRY AGAIN');
      setLoading(false);
      return;
    }

    const { data: attemptUrlData } = await supabase.storage
      .from('medicine-images')
      .createSignedUrl(attemptPath, 60);
    if (!attemptUrlData?.signedUrl) {
      setMessage('TRY AGAIN');
      setLoading(false);
      return;
    }

    const response = await fetch(`${backendUrl}/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference_image_url: referenceUrl,
        test_image_url: attemptUrlData.signedUrl,
        patient_id: patientId,
        medicine_id: medicineId,
      }),
    });

    if (!response.ok) {
      setMessage('TRY AGAIN');
      setLoading(false);
      return;
    }

    const data = (await response.json()) as CompareResponse;
    setAttemptsUsed(data.attempts_used);
    setMessage(data.approved ? 'APPROVED' : 'TRY AGAIN');
    setLoading(false);
  };

  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attemptsUsed);
  const canVerify = Boolean(patientId && medicineId && file && !loading && attemptsLeft > 0);

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-8 px-10 text-center">
      <div className={`text-5xl font-semibold ${message === 'TRY AGAIN' || message === 'CONTACT CAREGIVER' ? 'text-red-600' : 'text-foreground'}`}>
        {message}
      </div>
      <div className="flex w-full max-w-md flex-col gap-6">
        <Input
          aria-label="Medicine ID"
          placeholder="Medicine ID"
          value={medicineId}
          onChange={(event) => setMedicineId(event.target.value)}
          className="h-14 text-lg"
        />
        <Input
          aria-label="Medicine photo"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="h-14 text-lg"
        />
        <Button onClick={handleVerify} disabled={!canVerify} className="h-14 text-lg">
          {loading ? 'VERIFYING' : 'VERIFY'}
        </Button>
      </div>
    </div>
  );
}
