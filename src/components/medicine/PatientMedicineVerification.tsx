import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
 main

const MAX_ATTEMPTS = 10;

interface PatientMedicineVerificationProps {
  patientId: string | null;
}

interface CompareResponse {
  similarity_score: number;
  match: boolean;
  attempts_used: number;
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
  attempts_remaining: number;

  attempts_left: number;
 main
  approved: boolean;
}

export function PatientMedicineVerification({ patientId }: PatientMedicineVerificationProps) {
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq

  const { toast } = useToast();
 main
  const [medicineId, setMedicineId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState<number>(0);
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('TAKE MEDICINE PHOTO');

  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
 main

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

 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
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

  const fetchAttemptsUsed = async () => {
    if (!patientId || !medicineId) return 0;
    const attemptsPath = `patient/${patientId}/${medicineId}/attempts`;
    const { data } = await supabase.storage.from('medicine-images').list(attemptsPath);
    const count = data?.length ?? 0;
    setAttemptsUsed(count);
    return count;
 main
  };

  const fetchReferenceUrl = async () => {
    if (!patientId || !caregiverId || !medicineId) return null;
    const referencePath = `caregiver/${caregiverId}/${patientId}/${medicineId}/reference`;
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
    const { data: referenceList } = await supabase.storage
      .from('medicine-images')
      .list(referencePath, { limit: 1, sortBy: { column: 'created_at', order: 'desc' } });

    const latest = referenceList?.[0];
    if (!latest) return null;
    const { data: signedReference } = await supabase.storage
      .from('medicine-images')
      .createSignedUrl(`${referencePath}/${latest.name}`, 60);
    return signedReference?.signedUrl ?? null;

  const { data } = await supabase.storage
      .from('medicine-images')
      .list(referencePath, { limit: 1, sortBy: { column: 'created_at', order: 'desc' } });

    const latest = data?.[0];
    if (!latest) return null;
    const { data: publicData } = supabase.storage
      .from('medicine-images')
      .getPublicUrl(`${referencePath}/${latest.name}`);
    return publicData.publicUrl;
 main
  };

  const handleVerify = async () => {
    if (!patientId || !medicineId || !file) return;

    setLoading(true);
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
    const attempts = await fetchAttemptsUsed();
    if (attempts >= MAX_ATTEMPTS) {
      setMessage('CONTACT CAREGIVER');

    setResult(null);

    const attempts = await fetchAttemptsUsed();
    if (attempts >= MAX_ATTEMPTS) {
      toast({ variant: 'destructive', title: 'No attempts left', description: 'Please contact your caregiver.' });
 main
      setLoading(false);
      return;
    }

    const referenceUrl = await fetchReferenceUrl();
    if (!referenceUrl) {
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
      setMessage('CONTACT CAREGIVER');

      toast({ variant: 'destructive', title: 'Reference missing', description: 'Ask your caregiver to upload a reference image.' });
 main
      setLoading(false);
      return;
    }

    const safeName = file.name.replace(/\s+/g, '-');
    const attemptPath = `patient/${patientId}/${medicineId}/attempts/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from('medicine-images')
      .upload(attemptPath, file, { upsert: false, contentType: file.type });

    if (uploadError) {
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
      setMessage('TRY AGAIN');

      toast({ variant: 'destructive', title: 'Upload failed', description: uploadError.message });
 main
      setLoading(false);
      return;
    }

 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
    const { data: attemptUrlData } = await supabase.storage
      .from('medicine-images')
      .createSignedUrl(attemptPath, 60);
    if (!attemptUrlData?.signedUrl) {
      setMessage('TRY AGAIN');
      setLoading(false);
      return;
    }

    const { data: attemptUrlData } = supabase.storage
      .from('medicine-images')
      .getPublicUrl(attemptPath);
 main

    const response = await fetch(`${backendUrl}/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference_image_url: referenceUrl,
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
        test_image_url: attemptUrlData.signedUrl,

        test_image_url: attemptUrlData.publicUrl,
 main
        patient_id: patientId,
        medicine_id: medicineId,
      }),
    });

    if (!response.ok) {
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
      setMessage('TRY AGAIN');

      toast({ variant: 'destructive', title: 'Comparison failed', description: await response.text() });
 main
      setLoading(false);
      return;
    }

    const data = (await response.json()) as CompareResponse;
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
    setAttemptsUsed(data.attempts_used);
    setMessage(data.approved ? 'APPROVED' : 'TRY AGAIN');

    setResult(data);
    setAttemptsUsed(data.attempts_used);
 main
    setLoading(false);
  };

  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attemptsUsed);
  const canVerify = Boolean(patientId && medicineId && file && !loading && attemptsLeft > 0);

  return (
 codex/remove-lovable-traces-and-add-image-verification-m1ujfq
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

    <Card>
      <CardHeader>
        <CardTitle>Medicine Image Verification</CardTitle>
        <CardDescription>Capture a photo of your medicine before intake.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="patient-medicine-id">Medicine ID</Label>
          <Input
            id="patient-medicine-id"
            placeholder="e.g. amoxicillin-250mg"
            value={medicineId}
            onChange={(event) => setMedicineId(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="attempt-image">Medicine photo</Label>
          <Input
            id="attempt-image"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        <div className="text-sm text-muted-foreground">
          Attempts left: <span className="font-medium text-foreground">{attemptsLeft}</span>
        </div>
        <Button onClick={handleVerify} disabled={!canVerify}>
          {loading ? 'Verifying…' : 'Verify medicine'}
        </Button>
        {result && (
          <div className={`rounded-lg border p-3 text-sm ${result.approved ? 'border-green-500/60 bg-green-500/10' : 'border-amber-500/60 bg-amber-500/10'}`}>
            <p className="font-medium">
              {result.approved ? 'Approved — you may take this medicine.' : 'Not a match — please retry.'}
            </p>
            <p className="text-muted-foreground">Similarity score: {result.similarity_score.toFixed(3)}</p>
            <p className="text-muted-foreground">Attempts remaining: {result.attempts_left}</p>
          </div>
        )}
      </CardContent>
    </Card>
 main
  );
}
