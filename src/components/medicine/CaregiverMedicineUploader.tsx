import { useCallback, useEffect, useMemo, useState } from 'react';
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
      <Card>
        <CardHeader>
          <CardTitle>Medicine Reference Images</CardTitle>
          <CardDescription>Upload a clear reference photo for each patient&apos;s medicine.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="patient-select">Patient</Label>
            <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
              <SelectTrigger id="patient-select">
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
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reference-image">Reference image</Label>
            <Input
              id="reference-image"
              type="file"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {cameraState === 'denied' && (
              <p className="text-xs text-destructive">
                Camera permission denied. You can still upload from files.
              </p>
            )}
            {cameraState === 'unavailable' && (
              <p className="text-xs text-destructive">
                No camera available on this device/browser.
              </p>
            )}
            {cameraState !== 'granted' && (
              <Button type="button" variant="outline" onClick={() => void requestCameraPermission()}>
                Allow Camera Access
              </Button>
            )}
          </div>
          <Button onClick={handleUpload} disabled={!canUpload}>
            {uploading ? 'Uploading...' : 'Upload reference image'}
          </Button>
          {uploadedUrl && (
            <p className="break-all text-sm text-muted-foreground">
              Reference URL: <span className="font-medium text-primary">{uploadedUrl}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pill Verification Activity</CardTitle>
          <CardDescription>Live updates when patients complete medicine verification.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Patient Schedules</p>
            {patients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No patients assigned yet.</p>
            ) : (
              <div className="space-y-2">
                {patients.map((patient) => (
                  <div key={patient.id} className="rounded-md border p-2">
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
            <p className="text-sm font-medium">Recent Verifications</p>
            {pillLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pill verification logs yet.</p>
            ) : (
              <div className="space-y-2">
                {pillLogs.map((log) => {
                  const patientName = patientLookup[log.patient_id]?.name ?? 'Unknown patient';
                  const ok = log.verification_status === 'success';
                  const counterKey = `${log.patient_id}:${log.medicine_id}`;
                  const failedCount = attemptCounters[counterKey]?.consecutive_failed_attempts ?? 0;
                  return (
                    <div key={log.id} className="rounded-md border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium">{patientName}</p>
                        <Badge variant={ok ? 'secondary' : 'destructive'}>
                          {ok ? 'Verified' : 'Failed'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {log.time_of_day} | {log.medicine_id} | score {Number(log.similarity_score).toFixed(3)}
                      </p>
                      {!ok && failedCount >= 7 && (
                        <p className={`text-xs ${failedCount >= 10 ? 'text-destructive' : 'text-amber-600'}`}>
                          Consecutive failed attempts: {failedCount}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">{new Date(log.verified_at).toLocaleString()}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
