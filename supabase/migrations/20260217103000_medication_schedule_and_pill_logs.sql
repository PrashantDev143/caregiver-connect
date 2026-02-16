-- Medication schedule + pill verification logs
-- Safe additive migration; does not alter existing auth/verification/storage flow.

CREATE TABLE IF NOT EXISTS public.medication_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  time_of_day text NOT NULL CHECK (time_of_day IN ('morning', 'afternoon', 'evening')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, time_of_day)
);

CREATE TABLE IF NOT EXISTS public.pill_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  caregiver_id uuid NOT NULL REFERENCES public.caregivers(id) ON DELETE CASCADE,
  medicine_id text NOT NULL,
  time_of_day text NOT NULL CHECK (time_of_day IN ('morning', 'afternoon', 'evening')),
  verification_status text NOT NULL CHECK (verification_status IN ('success', 'failed')),
  similarity_score numeric NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medication_schedule_patient_idx
  ON public.medication_schedule (patient_id);

CREATE INDEX IF NOT EXISTS pill_logs_caregiver_verified_at_idx
  ON public.pill_logs (caregiver_id, verified_at DESC);

CREATE INDEX IF NOT EXISTS pill_logs_patient_verified_at_idx
  ON public.pill_logs (patient_id, verified_at DESC);

ALTER TABLE public.medication_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pill_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can manage own medication schedule" ON public.medication_schedule;
CREATE POLICY "Patients can manage own medication schedule"
ON public.medication_schedule
FOR ALL
TO authenticated
USING (
  patient_id IN (
    SELECT p.id FROM public.patients p WHERE p.user_id = auth.uid()
  )
)
WITH CHECK (
  patient_id IN (
    SELECT p.id FROM public.patients p WHERE p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Caregivers can view patient medication schedule" ON public.medication_schedule;
CREATE POLICY "Caregivers can view patient medication schedule"
ON public.medication_schedule
FOR SELECT
TO authenticated
USING (
  patient_id IN (
    SELECT p.id
    FROM public.patients p
    JOIN public.caregivers c ON c.id = p.caregiver_id
    WHERE c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Patients can insert own pill logs" ON public.pill_logs;
CREATE POLICY "Patients can insert own pill logs"
ON public.pill_logs
FOR INSERT
TO authenticated
WITH CHECK (
  patient_id IN (
    SELECT p.id FROM public.patients p WHERE p.user_id = auth.uid()
  )
  AND caregiver_id = (
    SELECT p.caregiver_id FROM public.patients p WHERE p.id = patient_id
  )
);

DROP POLICY IF EXISTS "Patients can view own pill logs" ON public.pill_logs;
CREATE POLICY "Patients can view own pill logs"
ON public.pill_logs
FOR SELECT
TO authenticated
USING (
  patient_id IN (
    SELECT p.id FROM public.patients p WHERE p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Caregivers can view own patient pill logs" ON public.pill_logs;
CREATE POLICY "Caregivers can view own patient pill logs"
ON public.pill_logs
FOR SELECT
TO authenticated
USING (
  caregiver_id IN (
    SELECT c.id FROM public.caregivers c WHERE c.user_id = auth.uid()
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pill_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pill_logs;
  END IF;
END $$;
