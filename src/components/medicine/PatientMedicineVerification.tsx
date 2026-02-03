import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

const MAX_ATTEMPTS = 10;

interface PatientMedicineVerificationProps {
  patientId: string | null;
}

interface CompareResponse {
  similarity_score: number;
  match: boolean;
  attempts_used: number;
  attempts_left: number;
  approved: boolean;
}

export function PatientMedicineVerification({ patientId }: PatientMedicineVerificationProps) {
  const { toast } = useToast();
  const [medicineId, setMedicineId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState<number>(0);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);

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

  const fetchAttemptsUsed = async () => {
    if (!patientId || !medicineId) return 0;
    const attemptsPath = `patient/${patientId}/${medicineId}/attempts`;
    const { data } = await supabase.storage.from('medicine-images').list(attemptsPath);
    const count = data?.length ?? 0;
    setAttemptsUsed(count);
    return count;
  };

  const fetchReferenceUrl = async () => {
    if (!patientId || !caregiverId || !medicineId) return null;
    const referencePath = `caregiver/${caregiverId}/${patientId}/${medicineId}/reference`;
    const { data } = await supabase.storage
      .from('medicine-images')
      .list(referencePath, { limit: 1, sortBy: { column: 'created_at', order: 'desc' } });

    const latest = data?.[0];
    if (!latest) return null;
    const { data: publicData } = supabase.storage
      .from('medicine-images')
      .getPublicUrl(`${referencePath}/${latest.name}`);
    return publicData.publicUrl;
  };

  const handleVerify = async () => {
    if (!patientId || !medicineId || !file) return;

    setLoading(true);
    setResult(null);

    const attempts = await fetchAttemptsUsed();
    if (attempts >= MAX_ATTEMPTS) {
      toast({ variant: 'destructive', title: 'No attempts left', description: 'Please contact your caregiver.' });
      setLoading(false);
      return;
    }

    const referenceUrl = await fetchReferenceUrl();
    if (!referenceUrl) {
      toast({ variant: 'destructive', title: 'Reference missing', description: 'Ask your caregiver to upload a reference image.' });
      setLoading(false);
      return;
    }

    const safeName = file.name.replace(/\s+/g, '-');
    const attemptPath = `patient/${patientId}/${medicineId}/attempts/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from('medicine-images')
      .upload(attemptPath, file, { upsert: false, contentType: file.type });

    if (uploadError) {
      toast({ variant: 'destructive', title: 'Upload failed', description: uploadError.message });
      setLoading(false);
      return;
    }

    const { data: attemptUrlData } = supabase.storage
      .from('medicine-images')
      .getPublicUrl(attemptPath);

    const response = await fetch(`${backendUrl}/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference_image_url: referenceUrl,
        test_image_url: attemptUrlData.publicUrl,
        patient_id: patientId,
        medicine_id: medicineId,
      }),
    });

    if (!response.ok) {
      toast({ variant: 'destructive', title: 'Comparison failed', description: await response.text() });
      setLoading(false);
      return;
    }

    const data = (await response.json()) as CompareResponse;
    setResult(data);
    setAttemptsUsed(data.attempts_used);
    setLoading(false);
  };

  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attemptsUsed);
  const canVerify = Boolean(patientId && medicineId && file && !loading && attemptsLeft > 0);

  return (
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
  );
}
