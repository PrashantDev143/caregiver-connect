-- =============================================================================
-- 1. FIX TRIGGER: RAISE NOTICE + safe role casting so DB rows are created.
-- 2. ADD TABLES: geofences, location_logs, alerts (RLS-safe).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Replace handle_new_user with logging and safe role cast
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_val app_role;
  meta_role text;
BEGIN
  meta_role := NEW.raw_user_meta_data->>'role';

  -- Safe cast: default to 'patient' if missing or invalid
  BEGIN
    IF meta_role IN ('caregiver', 'patient') THEN
      role_val := meta_role::app_role;
    ELSE
      role_val := 'patient'::app_role;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    role_val := 'patient'::app_role;
  END;

  RAISE NOTICE 'handle_new_user: user_id=%, email=%, meta_role=%, resolved_role=%',
    NEW.id, NEW.email, meta_role, role_val;

  INSERT INTO public.profiles (user_id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', 'User'));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, role_val);

  IF role_val = 'caregiver' THEN
    INSERT INTO public.caregivers (user_id, name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', 'User'));
    RAISE NOTICE 'handle_new_user: inserted caregivers row for user_id=%', NEW.id;
  ELSE
    INSERT INTO public.patients (user_id, name, email)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', 'User'), NEW.email);
    RAISE NOTICE 'handle_new_user: inserted patients row for user_id=%', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Create geofences, location_logs, alerts (required for patient map/location)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL UNIQUE REFERENCES public.patients(id) ON DELETE CASCADE,
  home_lat DOUBLE PRECISION NOT NULL,
  home_lng DOUBLE PRECISION NOT NULL,
  radius INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.location_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  message TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Patient: own geofence/location_logs/alerts
CREATE POLICY "patient geofence"
ON public.geofences FOR ALL
USING (patient_id = public.current_patient_id())
WITH CHECK (patient_id = public.current_patient_id());

CREATE POLICY "patient location_logs"
ON public.location_logs FOR ALL
USING (patient_id = public.current_patient_id())
WITH CHECK (patient_id = public.current_patient_id());

CREATE POLICY "patient alerts"
ON public.alerts FOR ALL
USING (patient_id = public.current_patient_id())
WITH CHECK (patient_id = public.current_patient_id());

-- Caregiver: read their patients' geofences, location_logs, alerts
CREATE POLICY "caregiver geofences"
ON public.geofences FOR SELECT
USING (patient_id IN (SELECT id FROM public.patients WHERE caregiver_id = public.current_caregiver_id()));

CREATE POLICY "caregiver location_logs"
ON public.location_logs FOR SELECT
USING (patient_id IN (SELECT id FROM public.patients WHERE caregiver_id = public.current_caregiver_id()));

CREATE POLICY "caregiver alerts"
ON public.alerts FOR SELECT
USING (patient_id IN (SELECT id FROM public.patients WHERE caregiver_id = public.current_caregiver_id()));

-- Caregiver: insert/update geofences for their patients
CREATE POLICY "caregiver geofences insert"
ON public.geofences FOR INSERT
WITH CHECK (patient_id IN (SELECT id FROM public.patients WHERE caregiver_id = public.current_caregiver_id()));

CREATE POLICY "caregiver geofences update"
ON public.geofences FOR UPDATE
USING (patient_id IN (SELECT id FROM public.patients WHERE caregiver_id = public.current_caregiver_id()));

-- Caregiver: update patients (assign caregiver_id when adding patient)
CREATE POLICY "caregiver update patients"
ON public.patients FOR UPDATE
USING (caregiver_id = public.current_caregiver_id() OR caregiver_id IS NULL)
WITH CHECK (caregiver_id = public.current_caregiver_id() OR caregiver_id IS NULL);
