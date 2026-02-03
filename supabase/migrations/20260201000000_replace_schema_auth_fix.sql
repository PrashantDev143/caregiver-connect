-- =============================================================================
-- REPLACE SCHEMA: Remove old schema completely, apply clean auth + core tables.
-- Run against the SAME project as your .env (Dashboard → Settings → API).
-- =============================================================================

-- 1. Drop trigger and handler (auth.users)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- 2. Drop triggers that use update_updated_at_column
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS update_geofences_updated_at ON public.geofences;
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;

-- 3. Drop tables (CASCADE drops dependent policies and objects)
DROP TABLE IF EXISTS public.alerts CASCADE;
DROP TABLE IF EXISTS public.location_logs CASCADE;
DROP TABLE IF EXISTS public.geofences CASCADE;
DROP TABLE IF EXISTS public.patients CASCADE;
DROP TABLE IF EXISTS public.caregivers CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 4. Drop old helper functions (signatures match existing)
DROP FUNCTION IF EXISTS public.get_patient_id(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_caregiver_id(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_user_role(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.has_role(UUID, public.app_role) CASCADE;

-- 5. Drop enum so we can recreate it
DROP TYPE IF EXISTS public.app_role CASCADE;

-- =============================================================================
-- CREATE: Clean, stable schema (exactly as specified)
-- =============================================================================

-- ENUM
CREATE TYPE public.app_role AS ENUM ('caregiver', 'patient');

-- PROFILES
CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- USER ROLES (ONE ROLE PER USER)
CREATE TABLE public.user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL
);

-- CAREGIVERS
CREATE TABLE public.caregivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

-- PATIENTS
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES public.caregivers(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL
);

-- HELPER FUNCTIONS (RLS SAFE)
CREATE OR REPLACE FUNCTION public.current_caregiver_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.caregivers WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_patient_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.patients WHERE user_id = auth.uid();
$$;

-- Frontend calls get_user_role(_user_id) – required for AuthContext
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
$$;

-- ENABLE RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caregivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES
CREATE POLICY "profile self"
ON public.profiles
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "role self"
ON public.user_roles
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "caregiver self"
ON public.caregivers
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "patient self"
ON public.patients
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "caregiver view patients"
ON public.patients
FOR SELECT
USING (caregiver_id = public.current_caregiver_id());

-- SIGNUP TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role app_role;
BEGIN
  role := (NEW.raw_user_meta_data->>'role')::app_role;

  INSERT INTO public.profiles (user_id, email, name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', 'User'));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, role);

  IF role = 'caregiver' THEN
    INSERT INTO public.caregivers (user_id, name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', 'User'));
  ELSE
    INSERT INTO public.patients (user_id, name, email)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', 'User'), NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
