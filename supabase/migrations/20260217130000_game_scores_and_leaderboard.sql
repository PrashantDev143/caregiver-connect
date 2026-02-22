-- Add game score tracking for patient games and caregiver leaderboard views.
-- Safe additive migration.

CREATE TABLE IF NOT EXISTS public.game_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  caregiver_id uuid NOT NULL REFERENCES public.caregivers(id) ON DELETE CASCADE,
  game_type text NOT NULL,
  score integer NOT NULL CHECK (score >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_scores_patient_idx
  ON public.game_scores (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS game_scores_caregiver_idx
  ON public.game_scores (caregiver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS game_scores_game_type_idx
  ON public.game_scores (game_type);

ALTER TABLE public.game_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients can insert own game scores" ON public.game_scores;
CREATE POLICY "Patients can insert own game scores"
ON public.game_scores
FOR INSERT
TO authenticated
WITH CHECK (
  patient_id IN (
    SELECT p.id
    FROM public.patients p
    WHERE p.user_id = auth.uid()
  )
  AND caregiver_id = (
    SELECT p.caregiver_id
    FROM public.patients p
    WHERE p.id = patient_id
  )
);

DROP POLICY IF EXISTS "Patients can view own game scores" ON public.game_scores;
CREATE POLICY "Patients can view own game scores"
ON public.game_scores
FOR SELECT
TO authenticated
USING (
  patient_id IN (
    SELECT p.id
    FROM public.patients p
    WHERE p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Caregivers can view own patient game scores" ON public.game_scores;
CREATE POLICY "Caregivers can view own patient game scores"
ON public.game_scores
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'game_scores'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_scores;
  END IF;
END $$;
