import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

const MAX_ATTEMPTS = 10;
type TimeOfDay = 'morning' | 'afternoon' | 'evening';
type CameraState = 'checking' | 'granted' | 'denied' | 'unavailable';

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
  const { toast } = useToast();
  const [medicineId, setMedicineId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [selectedTimeOfDay, setSelectedTimeOfDay] = useState<TimeOfDay>('morning');
  const [cameraState, setCameraState] = useState<CameraState>('checking');
  const [failedStreak, setFailedStreak] = useState(0);
  const [limitAlertRaised, setLimitAlertRaised] = useState(false);
  const [schedule, setSchedule] = useState<Record<TimeOfDay, boolean>>({
    morning: false,
    afternoon: false,
    evening: false,
  });

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
    };

    void loadSchedule();
  }, [patientId, toast]);

  const fetchAttemptsUsed = useCallback(async () => {
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

  const handleSaveSchedule = async () => {
    if (!patientId) return;

    setSavingSchedule(true);
    const payload = (['morning', 'afternoon', 'evening'] as TimeOfDay[]).map((timeOfDay) => ({
      patient_id: patientId,
      time_of_day: timeOfDay,
      enabled: schedule[timeOfDay],
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('medication_schedule')
      .upsert(payload, { onConflict: 'patient_id,time_of_day' });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to save schedule',
        description: error.message,
      });
      setSavingSchedule(false);
      return;
    }

    toast({
      title: 'Schedule saved',
      description: 'Your medication time preferences were updated.',
    });
    setSavingSchedule(false);
  };

  const handleVerify = async () => {
    if (!patientId || !medicineId || !file) return;

    setLoading(true);
    setResult(null);
    setLimitAlertRaised(false);

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

    const { data: attemptUrlData } = await supabase.storage
      .from('medicine-images')
      .createSignedUrl(attemptPath, 60);
    if (!attemptUrlData?.signedUrl) {
      toast({ variant: 'destructive', title: 'Upload failed', description: 'Unable to generate a signed URL.' });
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
      toast({ variant: 'destructive', title: 'Comparison failed', description: await response.text() });
      setLoading(false);
      return;
    }

    const data = (await response.json()) as CompareResponse;
    setResult(data);
    setAttemptsUsed(data.attempts_used);

    if (caregiverId) {
      const { data: trackingData, error: trackingError } = await supabase.rpc('record_pill_attempt', {
        _patient_id: patientId,
        _caregiver_id: caregiverId,
        _medicine_id: medicineId,
        _time_of_day: selectedTimeOfDay,
        _similarity_score: data.similarity_score,
        _verification_status: data.approved ? 'success' : 'failed',
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
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Medication Schedule</p>
            <p className="text-xs text-muted-foreground">Choose when you usually take medicine.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['morning', 'afternoon', 'evening'] as TimeOfDay[]).map((timeOfDay) => (
              <Button
                key={timeOfDay}
                type="button"
                variant={schedule[timeOfDay] ? 'default' : 'outline'}
                onClick={() =>
                  setSchedule((prev) => ({
                    ...prev,
                    [timeOfDay]: !prev[timeOfDay],
                  }))
                }
              >
                {timeOfDay}
              </Button>
            ))}
          </div>
          <Button type="button" variant="secondary" onClick={handleSaveSchedule} disabled={savingSchedule || !patientId}>
            {savingSchedule ? 'Saving schedule...' : 'Save schedule'}
          </Button>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="time-of-day">Time of day</Label>
          <Select value={selectedTimeOfDay} onValueChange={(value) => setSelectedTimeOfDay(value as TimeOfDay)}>
            <SelectTrigger id="time-of-day">
              <SelectValue placeholder="Select time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="morning">Morning</SelectItem>
              <SelectItem value="afternoon">Afternoon</SelectItem>
              <SelectItem value="evening">Evening</SelectItem>
            </SelectContent>
          </Select>
        </div>

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
          {cameraState === 'denied' && (
            <p className="text-sm text-destructive">
              Camera permission denied. Enable it in browser settings, then retry.
            </p>
          )}
          {cameraState === 'unavailable' && (
            <p className="text-sm text-destructive">
              Camera unavailable on this device/browser. You can still upload from files.
            </p>
          )}
          {cameraState !== 'granted' && (
            <Button type="button" variant="outline" onClick={() => void requestCameraPermission()}>
              Allow Camera Access
            </Button>
          )}
        </div>
        <div className="text-sm text-muted-foreground">
          Attempts left: <span className="font-medium text-foreground">{attemptsLeft}</span>
        </div>
        {failedStreak >= 7 && failedStreak < 10 && (
          <p className="text-sm text-amber-600">
            Warning: {failedStreak} unsuccessful attempts in a row. You have {Math.max(0, 10 - failedStreak)} before caregiver alert.
          </p>
        )}
        {failedStreak >= 10 && (
          <p className="text-sm text-destructive">
            Alert threshold reached: caregiver has been notified after 10 unsuccessful attempts.
          </p>
        )}
        {limitAlertRaised && (
          <p className="text-sm text-destructive">
            Caregiver notification sent: Patient has not taken the pill after 10 unsuccessful attempts.
          </p>
        )}
        <Button onClick={handleVerify} disabled={!canVerify}>
          {loading ? 'Verifying...' : 'Verify medicine'}
        </Button>
        {result && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              result.approved ? 'border-green-500/60 bg-green-500/10' : 'border-amber-500/60 bg-amber-500/10'
            }`}
          >
            <p className="font-medium">
              {result.approved ? 'Approved - you may take this medicine.' : 'Not a match - please retry.'}
            </p>
            <p className="text-muted-foreground">Similarity score: {result.similarity_score.toFixed(3)}</p>
            <p className="text-muted-foreground">Attempts remaining: {result.attempts_remaining}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
