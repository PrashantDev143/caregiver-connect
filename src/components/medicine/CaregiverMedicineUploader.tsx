import { useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

export function CaregiverMedicineUploader({ caregiverId, patients }: CaregiverMedicineUploaderProps) {
  const { toast } = useToast();
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [medicineId, setMedicineId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const canUpload = caregiverId && selectedPatientId && medicineId && file && !uploading;

  const patientOptions = useMemo(
    () => patients.map((patient) => ({ value: patient.id, label: `${patient.name} (${patient.email})` })),
    [patients]
  );

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
        </div>
        <Button onClick={handleUpload} disabled={!canUpload}>
          {uploading ? 'Uploading…' : 'Upload reference image'}
        </Button>
        {uploadedUrl && (
          <p className="text-sm text-muted-foreground break-all">
            Reference URL: <span className="font-medium text-primary">{uploadedUrl}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
