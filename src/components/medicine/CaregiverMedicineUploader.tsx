import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface PatientOption {
  id: string;
  name: string;
  email: string;
}

interface CaregiverMedicineUploaderProps {
  caregiverId: string | null;
  patients: PatientOption[];
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening';

interface PillLog {
  id: string;
  patient_id: string;
  medicine_id: string;
  time_of_day: TimeOfDay;
  verification_status: 'success' | 'failed';
  similarity_score: number;
  verified_at: string;
}

interface AttemptCounter {
  patient_id: string;
  medicine_id: string;
  consecutive_failed_attempts: number;
}

type CameraState = 'checking' | 'granted' | 'denied' | 'unavailable';

export function CaregiverMedicineUploader({ caregiverId, patients }: CaregiverMedicineUploaderProps) {
  const { toast } = useToast();
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [medicineId, setMedicineId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [pillLogs, setPillLogs] = useState<PillLog[]>([]);
  const [scheduleMap, setScheduleMap] = useState<Record<string, TimeOfDay[]>>({});
  const [attemptCounters, setAttemptCounters] = useState<Record<string, AttemptCounter>>({});
  const [cameraState, setCameraState] = useState<CameraState>('checking');

  const requestCameraPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      return;
    }

    setCameraState('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
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

  const canUpload = caregiverId && selectedPatientId && medicineId && file && !uploading;

  const patientOptions = useMemo(
    () => patients.map((patient) => ({ value: patient.id, label: `${patient.name} (${patient.email})` })),
    [patients]
  );

  const patientLookup = useMemo(
    () =>
      patients.reduce<Record<string, PatientOption>>((acc, patient) => {
        acc[patient.id] = patient;
        return acc;
      }, {}),
    [patients]
  );

  const successfulLogs = useMemo(
    () => pillLogs.filter((log) => log.verification_status === 'success'),
    [pillLogs]
  );

  const missedOrDelayedLogs = useMemo(
    () => pillLogs.filter((log) => log.verification_status !== 'success'),
    [pillLogs]
  );

  useEffect(() => {
    if (!caregiverId) return;

    const fetchLogs = async () => {
      const { data, error } = await supabase
        .from('pill_logs')
        .select('id, patient_id, medicine_id, time_of_day, verification_status, similarity_score, verified_at')
        .eq('caregiver_id', caregiverId)
        .order('verified_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('[CaregiverMedicineUploader] failed to load pill logs:', error.message);
        return;
      }

      setPillLogs((data ?? []) as PillLog[]);
    };

    void fetchLogs();

    const channel = supabase
      .channel(`pill-logs-${caregiverId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pill_logs',
          filter: `caregiver_id=eq.${caregiverId}`,
        },
        (payload) => {
          const next = payload.new as PillLog;
          setPillLogs((prev) => [next, ...prev].slice(0, 20));

          if (next.verification_status === 'success') {
            const patientName = patientLookup[next.patient_id]?.name ?? 'Patient';
            toast({
              title: 'Medicine verified',
              description: `${patientName} completed ${next.time_of_day} verification.`,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caregiverId, patientLookup, toast]);

  useEffect(() => {
    if (!caregiverId) return;

    const fetchCounters = async () => {
      const { data, error } = await supabase
        .from('pill_attempt_counters')
        .select('patient_id, medicine_id, consecutive_failed_attempts')
        .eq('caregiver_id', caregiverId);

      if (error) {
        console.error('[CaregiverMedicineUploader] failed to load attempt counters:', error.message);
        return;
      }

      const map: Record<string, AttemptCounter> = {};
      for (const row of data ?? []) {
        map[`${row.patient_id}:${row.medicine_id}`] = {
          patient_id: row.patient_id,
          medicine_id: row.medicine_id,
          consecutive_failed_attempts: row.consecutive_failed_attempts,
        };
      }
      setAttemptCounters(map);
    };

    void fetchCounters();

    const counterChannel = supabase
      .channel(`pill-counters-${caregiverId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pill_attempt_counters',
          filter: `caregiver_id=eq.${caregiverId}`,
        },
        (payload) => {
          const next = payload.new as AttemptCounter;
          const key = `${next.patient_id}:${next.medicine_id}`;
          setAttemptCounters((prev) => {
            const prevCount = prev[key]?.consecutive_failed_attempts ?? 0;
            if (prevCount < 10 && next.consecutive_failed_attempts >= 10) {
              const patientName = patientLookup[next.patient_id]?.name ?? 'Patient';
              toast({
                variant: 'destructive',
                title: 'Medication adherence alert',
                description: `${patientName} has not taken the pill after 10 unsuccessful attempts.`,
              });
            }
            return { ...prev, [key]: next };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(counterChannel);
    };
  }, [caregiverId, patientLookup, toast]);

  useEffect(() => {
    void requestCameraPermission();
  }, [requestCameraPermission]);

  useEffect(() => {
    const fetchSchedules = async () => {
      if (patients.length === 0) {
        setScheduleMap({});
        return;
      }

      const patientIds = patients.map((patient) => patient.id);
      const { data, error } = await supabase
        .from('medication_schedule')
        .select('patient_id, time_of_day, enabled')
        .in('patient_id', patientIds)
        .eq('enabled', true);

      if (error) {
        console.error('[CaregiverMedicineUploader] failed to load schedules:', error.message);
        return;
      }

      const map: Record<string, TimeOfDay[]> = {};
      for (const row of data ?? []) {
        const pid = row.patient_id;
        const tod = row.time_of_day as TimeOfDay;
        if (!map[pid]) map[pid] = [];
        map[pid].push(tod);
      }
      setScheduleMap(map);
    };

    void fetchSchedules();
  }, [patients]);

  const handleUpload = async () => {
    if (!canUpload || !caregiverId || !file) return;

    setUploading(true);
    setUploadedUrl(null);

    const safeName = file.name.replace(/\s+/g, '-');
    const storagePath = `caregiver/${caregiverId}/${selectedPatientId}/${medicineId}/reference/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from('medicine-images')
      .upload(storagePath, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      toast({ variant: 'destructive', title: 'Upload failed', description: uploadError.message });
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from('medicine-images').getPublicUrl(storagePath);
    setUploadedUrl(data.publicUrl);
    setUploading(false);
    toast({ title: 'Reference image uploaded', description: 'Patients can now verify this medicine.' });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-primary/20 shadow-sm transition-all duration-300 hover:border-primary/35 hover:shadow-lg">
        <CardHeader className="bg-gradient-to-r from-cyan-500/10 via-background to-primary/5">
          <CardTitle>Medicine Reference Images</CardTitle>
          <CardDescription>Upload a clear reference photo for each patient&apos;s medicine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-2">
            <Label htmlFor="patient-select">Patient</Label>
            <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
              <SelectTrigger id="patient-select" className="h-11 rounded-xl">
                <SelectValue placeholder="Select a patient" />
              </SelectTrigger>
              <SelectContent>
                {patientOptions.map((patient) => (
                  <SelectItem key={patient.value} value={patient.value}>
                    {patient.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="medicine-id">Medicine ID</Label>
            <Input
              id="medicine-id"
              placeholder="e.g. amoxicillin-250mg"
              value={medicineId}
              onChange={(event) => setMedicineId(event.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="reference-image">Reference image</Label>
            <Input
              id="reference-image"
              type="file"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="h-11 rounded-xl"
            />
            {cameraState === 'denied' && (
              <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Camera permission denied. You can still upload from files.
              </p>
            )}
            {cameraState === 'unavailable' && (
              <p className="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                No camera available on this device/browser.
              </p>
            )}
            {cameraState !== 'granted' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void requestCameraPermission()}
                className="rounded-xl transition-all duration-200 hover:-translate-y-0.5"
              >
                Allow Camera Access
              </Button>
            )}
          </div>

          <Button
            onClick={handleUpload}
            disabled={!canUpload}
            className="h-11 rounded-xl font-semibold transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
          >
            {uploading ? 'Uploading...' : 'Upload reference image'}
          </Button>

          {uploadedUrl && (
            <p className="break-all rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
              Reference URL: <span className="font-medium text-primary">{uploadedUrl}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-primary/20 shadow-sm transition-all duration-300 hover:border-primary/35 hover:shadow-lg">
        <CardHeader className="bg-gradient-to-r from-amber-100/60 via-background to-primary/5">
          <CardTitle>Pill Verification Activity</CardTitle>
          <CardDescription>Live updates from patient medicine verification.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="space-y-2">
            <p className="text-sm font-semibold">Patient Schedules</p>
            {patients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No patients assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {patients.map((patient) => (
                  <div key={patient.id} className="rounded-xl border border-border/80 p-3 transition-colors hover:bg-muted/20">
                    <p className="text-sm font-medium">{patient.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(scheduleMap[patient.id] ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">No schedule set</span>
                      ) : (
                        (scheduleMap[patient.id] ?? []).map((slot) => (
                          <Badge key={`${patient.id}-${slot}`} variant="outline">
                            {slot}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Recent Successful Verifications</p>
            {successfulLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No successful verifications yet.</p>
            ) : (
              <div className="space-y-2">
                {successfulLogs.map((log) => {
                  const patientName = patientLookup[log.patient_id]?.name ?? 'Unknown patient';
                  return (
                    <div key={log.id} className="rounded-xl border border-emerald-300/40 bg-emerald-50/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{patientName}</p>
                        <Badge className="border-emerald-400/60 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Verified
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {log.time_of_day} | {log.medicine_id} | score {Number(log.similarity_score).toFixed(3)}
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(log.verified_at).toLocaleString()}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-amber-300/55 bg-amber-50/40 p-3">
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-700" />
              <p className="text-sm font-semibold text-amber-800">Missed / Delayed Medicine</p>
            </div>

            <div className="h-72 space-y-2 overflow-y-auto pr-1">
              {missedOrDelayedLogs.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-amber-300/60 bg-white/60 p-3 text-center text-sm text-amber-700">
                  No missed or delayed entries right now.
                </div>
              ) : (
                missedOrDelayedLogs.map((log) => {
                  const patientName = patientLookup[log.patient_id]?.name ?? 'Unknown patient';
                  const counterKey = `${log.patient_id}:${log.medicine_id}`;
                  const failedCount = attemptCounters[counterKey]?.consecutive_failed_attempts ?? 0;
                  const statusLabel = failedCount >= 10 ? 'Missed' : 'Delayed';
                  const statusClass =
                    statusLabel === 'Missed'
                      ? 'border-rose-300 bg-rose-100 text-rose-700'
                      : 'border-amber-300 bg-amber-100 text-amber-700';

                  return (
                    <div key={log.id} className="rounded-lg border border-amber-300/40 bg-white/80 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-slate-800">{patientName}</p>
                          <p className="text-xs text-muted-foreground">
                            {log.time_of_day} | {log.medicine_id}
                          </p>
                        </div>
                        <Badge variant="outline" className={statusClass}>
                          <Clock3 className="mr-1 h-3 w-3" />
                          {statusLabel}
                        </Badge>
                      </div>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Match score {Number(log.similarity_score).toFixed(3)} | Failed streak {failedCount}
                      </p>
                      <p className="text-xs text-muted-foreground">{new Date(log.verified_at).toLocaleString()}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
