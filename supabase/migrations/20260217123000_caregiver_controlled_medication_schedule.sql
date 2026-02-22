-- Convert medication scheduling to caregiver-controlled ownership.
-- Safe additive migration: keeps existing table/data and hardens access rules.

ALTER TABLE public.medication_schedule
  ADD COLUMN IF NOT EXISTS caregiver_id uuid REFERENCES public.caregivers(id) ON DELETE CASCADE;

-- Backfill caregiver_id from patient assignment where possible.
UPDATE public.medication_schedule ms
SET caregiver_id = p.caregiver_id
FROM public.patients p
WHERE p.id = ms.patient_id
  AND ms.caregiver_id IS NULL;

CREATE INDEX IF NOT EXISTS medication_schedule_caregiver_idx
  ON public.medication_schedule (caregiver_id);

CREATE INDEX IF NOT EXISTS medication_schedule_patient_time_idx
  ON public.medication_schedule (patient_id, time_of_day);

-- Keep uniqueness per patient per time slot.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'medication_schedule_patient_time_key'
      AND conrelid = 'public.medication_schedule'::regclass
  ) THEN
    ALTER TABLE public.medication_schedule
      ADD CONSTRAINT medication_schedule_patient_time_key UNIQUE (patient_id, time_of_day);
  END IF;
END $$;

ALTER TABLE public.medication_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can manage own medication schedule" ON public.medication_schedule;
DROP POLICY IF EXISTS "Caregivers can view patient medication schedule" ON public.medication_schedule;
DROP POLICY IF EXISTS "Caregivers can manage own patient medication schedule" ON public.medication_schedule;
DROP POLICY IF EXISTS "Caregivers can insert own patient medication schedule" ON public.medication_schedule;
DROP POLICY IF EXISTS "Caregivers can update own patient medication schedule" ON public.medication_schedule;
DROP POLICY IF EXISTS "Caregivers can select own patient medication schedule" ON public.medication_schedule;
DROP POLICY IF EXISTS "Patients can view own medication schedule" ON public.medication_schedule;

CREATE POLICY "Caregivers can insert own patient medication schedule"
ON public.medication_schedule
FOR INSERT
TO authenticated
WITH CHECK (
  caregiver_id IN (
    SELECT c.id
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
  )
  AND patient_id IN (
    SELECT p.id
    FROM public.patients p
    WHERE p.caregiver_id = caregiver_id
  )
);

CREATE POLICY "Caregivers can update own patient medication schedule"
ON public.medication_schedule
FOR UPDATE
TO authenticated
USING (
  caregiver_id IN (
    SELECT c.id
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
  )
  AND patient_id IN (
    SELECT p.id
    FROM public.patients p
    WHERE p.caregiver_id = caregiver_id
  )
)
WITH CHECK (
  caregiver_id IN (
    SELECT c.id
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
  )
  AND patient_id IN (
    SELECT p.id
    FROM public.patients p
    WHERE p.caregiver_id = caregiver_id
  )
);

CREATE POLICY "Caregivers can select own patient medication schedule"
ON public.medication_schedule
FOR SELECT
TO authenticated
USING (
  caregiver_id IN (
    SELECT c.id
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
  )
  AND patient_id IN (
    SELECT p.id
    FROM public.patients p
    WHERE p.caregiver_id = caregiver_id
  )
);

CREATE POLICY "Patients can view own medication schedule"
ON public.medication_schedule
FOR SELECT
TO authenticated
USING (
  patient_id IN (
    SELECT p.id
    FROM public.patients p
    WHERE p.user_id = auth.uid()
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'medication_schedule'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.medication_schedule;
  END IF;
END $$;
