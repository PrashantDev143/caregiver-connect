import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Camera, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { CelebrationOverlay } from '@/components/ui/celebration-overlay';
import { useToast } from '@/hooks/use-toast';

const MAX_ATTEMPTS = 10;
type TimeOfDay = 'morning' | 'afternoon' | 'evening';
type CameraState = 'checking' | 'granted' | 'denied' | 'unavailable';

interface PatientMedicineVerificationProps {
  patientId: string | null;
}

interface CompareResponse {
  similarity_score: number;
  text_similarity_score: number | null;
  final_similarity_score: number;
  match: boolean;
  attempts_used: number;
  attempts_remaining: number;
  approved: boolean;
}

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const slotLabel: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

export function PatientMedicineVerification({ patientId }: PatientMedicineVerificationProps) {
  const { toast } = useToast();
  const [medicineId, setMedicineId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('checking');
  const [failedStreak, setFailedStreak] = useState(0);
  const [limitAlertRaised, setLimitAlertRaised] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [schedule, setSchedule] = useState<Record<TimeOfDay, boolean>>({
    morning: false,
    afternoon: false,
    evening: false,
  });
  const [selectedTimeOfDay, setSelectedTimeOfDay] = useState<TimeOfDay>('morning');

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
    if (!patientId) return;

    const loadSchedule = async () => {
      const { data, error } = await supabase
        .from('medication_schedule')
        .select('time_of_day, enabled')
        .eq('patient_id', patientId);

      if (error) {
        toast({
          variant: 'destructive',
          title: 'Schedule load failed',
          description: error.message,
        });
        return;
      }

      const next: Record<TimeOfDay, boolean> = {
        morning: false,
        afternoon: false,
        evening: false,
      };

      (data ?? []).forEach((entry) => {
        const key = entry.time_of_day as TimeOfDay;
        if (key in next) next[key] = Boolean(entry.enabled);
      });

      setSchedule(next);

      const hour = new Date().getHours();
      const currentSlot: TimeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
      const preferredSlot = next[currentSlot]
        ? currentSlot
        : (['morning', 'afternoon', 'evening'] as TimeOfDay[]).find((slot) => next[slot]) ?? 'morning';
      setSelectedTimeOfDay(preferredSlot);
    };

    void loadSchedule();
  }, [patientId, toast]);

  const fetchAttemptsUsed = useCallback(async () => {
    if (!patientId || !medicineId) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const { count, error, status } = await supabase
      .from('medicine_verification_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .eq('medicine_id', medicineId)
      .eq('attempt_date', today);

    if (error) {
      if (status !== 404) {
        console.error('[PatientMedicineVerification] attempts fetch failed:', error.message);
      }
      setAttemptsUsed(0);
      return 0;
    }

    const resolvedCount = count ?? 0;
    setAttemptsUsed(resolvedCount);
    return resolvedCount;
  }, [patientId, medicineId]);

  useEffect(() => {
    if (!patientId || !medicineId) return;
    void fetchAttemptsUsed();
  }, [patientId, medicineId, fetchAttemptsUsed]);

  const requestCameraPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      return;
    }

    setCameraState('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      stream.getTracks().forEach((track) => track.stop());
      setCameraState('granted');
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setCameraState('denied');
      } else {
        setCameraState('unavailable');
      }
    }
  }, []);

  useEffect(() => {
    void requestCameraPermission();
  }, [requestCameraPermission]);

  useEffect(() => {
    if (!patientId || !medicineId) return;

    const fetchCounter = async () => {
      const { data, error } = await supabase
        .from('pill_attempt_counters')
        .select('consecutive_failed_attempts')
        .eq('patient_id', patientId)
        .eq('medicine_id', medicineId)
        .maybeSingle();

      if (!error && data) {
        setFailedStreak(data.consecutive_failed_attempts ?? 0);
      } else if (!data) {
        setFailedStreak(0);
      }
    };

    void fetchCounter();
  }, [patientId, medicineId]);

  useEffect(() => {
    if (!result?.approved) return;
    setShowCelebration(true);
    const timer = window.setTimeout(() => setShowCelebration(false), 2600);
    return () => window.clearTimeout(timer);
  }, [result?.approved]);

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
    setResult(null);
    setLimitAlertRaised(false);
    try {
      const attempts = await fetchAttemptsUsed();
      if (attempts >= MAX_ATTEMPTS) {
        toast({ variant: 'destructive', title: 'No attempts left', description: 'Please contact your caregiver.' });
        return;
      }

      const referenceUrl = await fetchReferenceUrl();
      if (!referenceUrl) {
        toast({ variant: 'destructive', title: 'Reference missing', description: 'Ask your caregiver to upload a reference image.' });
        return;
      }

      const safeName = file.name.replace(/\s+/g, '-');
      const attemptPath = `patient/${patientId}/${medicineId}/attempts/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from('medicine-images')
        .upload(attemptPath, file, { upsert: false, contentType: file.type });

      if (uploadError) {
        toast({ variant: 'destructive', title: 'Upload failed', description: uploadError.message });
        return;
      }

      const { data: attemptUrlData } = await supabase.storage
        .from('medicine-images')
        .createSignedUrl(attemptPath, 60);
      if (!attemptUrlData?.signedUrl) {
        toast({ variant: 'destructive', title: 'Upload failed', description: 'Unable to generate a signed URL.' });
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
        toast({ variant: 'destructive', title: 'Comparison failed', description: await response.text() });
        return;
      }

      const rawData = (await response.json()) as Partial<CompareResponse>;
      const normalized: CompareResponse = {
        similarity_score: toNumber(rawData.similarity_score, 0),
        text_similarity_score:
          rawData.text_similarity_score === null || rawData.text_similarity_score === undefined
            ? null
            : toNumber(rawData.text_similarity_score, 0),
        final_similarity_score: toNumber(rawData.final_similarity_score, toNumber(rawData.similarity_score, 0)),
        match: Boolean(rawData.match),
        attempts_used: toNumber(rawData.attempts_used, attempts + 1),
        attempts_remaining: toNumber(rawData.attempts_remaining, Math.max(0, MAX_ATTEMPTS - (attempts + 1))),
        approved: Boolean(rawData.approved),
      };

      setResult(normalized);
      setAttemptsUsed(normalized.attempts_used);

      if (caregiverId) {
        const hour = new Date().getHours();
        const currentSlot: TimeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
        const resolvedSlot = schedule[currentSlot]
          ? currentSlot
          : (['morning', 'afternoon', 'evening'] as TimeOfDay[]).find((slot) => schedule[slot]) ?? selectedTimeOfDay;
        setSelectedTimeOfDay(resolvedSlot);

        const rpcTextScore = normalized.text_similarity_score ?? null;
        const rpcFinalScore = normalized.final_similarity_score ?? normalized.similarity_score;
        const { data: trackingData, error: trackingError } = await supabase.rpc('record_pill_attempt', {
          _patient_id: patientId,
          _caregiver_id: caregiverId,
          _medicine_id: medicineId,
          _time_of_day: resolvedSlot,
          _similarity_score: normalized.similarity_score,
          _text_similarity_score: rpcTextScore,
          _final_similarity_score: rpcFinalScore,
          _verification_status: normalized.approved ? 'success' : 'failed',
        });

        if (trackingError) {
          console.error('[PatientMedicineVerification] attempt tracking failed:', trackingError.message);
        } else {
          const row = Array.isArray(trackingData) ? trackingData[0] : null;
          const nextFailed = Number(row?.consecutive_failed_attempts ?? 0);
          const nextNotify = Boolean(row?.notify_caregiver);
          setFailedStreak(nextFailed);
          setLimitAlertRaised(nextNotify);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected verification failure.';
      console.error('[PatientMedicineVerification] verify failed:', error);
      toast({ variant: 'destructive', title: 'Verification error', description: message });
    } finally {
      setLoading(false);
    }
  };

  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attemptsUsed);
  const canVerify = Boolean(patientId && medicineId && file && !loading && attemptsLeft > 0);
  const enabledSlots = (['morning', 'afternoon', 'evening'] as TimeOfDay[]).filter((slot) => schedule[slot]);
  const attemptsRemainingPercent = (attemptsLeft / MAX_ATTEMPTS) * 100;

  return (
    <div className="relative">
      <CelebrationOverlay
        active={showCelebration}
        fullscreen
        message="Great job! Medicine taken successfully"
        submessage="You completed your verification and your caregiver has been updated."
      />

      <Card className="overflow-hidden border-primary/20 shadow-sm transition-all duration-300 hover:border-primary/40 hover:shadow-xl">
        <CardHeader className="bg-gradient-to-r from-cyan-500/10 via-primary/5 to-emerald-500/10">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Medicine Image Verification
          </CardTitle>
          <CardDescription>Snap or upload a clear photo before taking your medicine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="space-y-3 rounded-xl border border-primary/15 bg-primary/5 p-4 transition-colors">
            <div>
              <p className="text-sm font-semibold text-foreground">Today&apos;s medication schedule</p>
              <p className="text-xs text-muted-foreground">Read-only schedule set by your caregiver.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {enabledSlots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No schedule configured yet. Ask your caregiver to set it.</p>
              ) : (
                enabledSlots.map((slot) => (
                  <span
                    key={slot}
                    className="rounded-full border border-primary/30 bg-background px-3 py-1 text-xs font-medium text-foreground"
                  >
                    {slotLabel[slot]}
                  </span>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Verification log slot: <span className="font-semibold text-foreground">{slotLabel[selectedTimeOfDay]}</span>
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="patient-medicine-id">Medicine ID</Label>
            <Input
              id="patient-medicine-id"
              placeholder="e.g. amoxicillin-250mg"
              value={medicineId}
              onChange={(event) => setMedicineId(event.target.value)}
              className="h-11 rounded-xl border-border/80 transition-all duration-200 focus-visible:scale-[1.01]"
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
              className="h-11 rounded-xl border-border/80 transition-all duration-200 file:font-medium focus-visible:scale-[1.01]"
            />

            {cameraState === 'denied' && (
              <p className="rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Camera permission is currently off. You can still upload from your gallery.
              </p>
            )}
            {cameraState === 'unavailable' && (
              <p className="rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Camera is unavailable on this device/browser. File upload still works.
              </p>
            )}
            {cameraState !== 'granted' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void requestCameraPermission()}
                className="h-10 rounded-xl transition-all duration-200 hover:-translate-y-0.5"
              >
                <Camera className="h-4 w-4" />
                Allow Camera Access
              </Button>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-primary/15 bg-background p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Attempts remaining</span>
              <span className="font-semibold text-primary">
                {attemptsLeft} / {MAX_ATTEMPTS}
              </span>
            </div>
            <Progress value={attemptsRemainingPercent} className="h-2 bg-primary/10" />
            <p className="text-xs text-muted-foreground">
              {attemptsUsed} of {MAX_ATTEMPTS} attempts used today.
            </p>
          </div>

          {failedStreak >= 7 && failedStreak < 10 && (
            <p className="rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              You are close. {Math.max(0, 10 - failedStreak)} attempts remain before your caregiver is notified to assist.
            </p>
          )}
          {failedStreak >= 10 && (
            <p className="rounded-lg border border-rose-300/40 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Your caregiver has been notified and can help you with your next verification.
            </p>
          )}
          {limitAlertRaised && (
            <p className="rounded-lg border border-rose-300/40 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Caregiver notification sent after 10 unsuccessful attempts.
            </p>
          )}

          <Button
            onClick={handleVerify}
            disabled={!canVerify}
            className="h-12 w-full rounded-xl text-base font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying medicine...
              </>
            ) : (
              'Verify Medicine'
            )}
          </Button>

          {loading && (
            <div className="soft-appear rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-3">
                <div className="relative h-9 w-9">
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Checking medicine match</p>
                  <p className="text-xs text-muted-foreground">Uploading and comparing your image securely.</p>
                </div>
              </div>
            </div>
          )}

          {result && (
            <div
              className={`rounded-xl border p-4 text-sm soft-appear ${
                result.approved ? 'border-emerald-500/45 bg-emerald-50' : 'border-amber-500/45 bg-amber-50'
              }`}
            >
              <p className="flex items-center gap-2 font-semibold">
                {result.approved ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Great job! Medicine taken successfully
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                    Almost there. Let&apos;s retry with a clearer photo.
                  </>
                )}
              </p>
              {!result.approved && (
                <p className="mt-1 text-xs text-amber-700">
                  Tip: Keep the medicine label visible and take the picture in good lighting.
                </p>
              )}
              <div className="mt-3 space-y-1 text-muted-foreground">
                <p>Similarity score: {toNumber(result.similarity_score, 0).toFixed(3)}</p>
                <p>
                  Text similarity score:{' '}
                  {result.text_similarity_score === null ? 'N/A (text not confidently extracted)' : toNumber(result.text_similarity_score, 0).toFixed(3)}
                </p>
                <p>Final combined score: {toNumber(result.final_similarity_score, toNumber(result.similarity_score, 0)).toFixed(3)}</p>
                <p>Attempts remaining: {result.attempts_remaining}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
