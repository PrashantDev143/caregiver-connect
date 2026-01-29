-- Create enum for user roles
CREATE TYPE public.app_role AS ENUM ('caregiver', 'patient');

-- Create profiles table (stores user info)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create user_roles table (separate table for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);

-- Create caregivers table
CREATE TABLE public.caregivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create patients table
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  caregiver_id UUID REFERENCES public.caregivers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create geofences table
CREATE TABLE public.geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID UNIQUE REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  home_lat DOUBLE PRECISION NOT NULL,
  home_lng DOUBLE PRECISION NOT NULL,
  radius INTEGER NOT NULL DEFAULT 100,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create location_logs table
CREATE TABLE public.location_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create alerts table
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  message TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable Row Level Security on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caregivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create security definer function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Create function to get caregiver_id from user_id
CREATE OR REPLACE FUNCTION public.get_caregiver_id(_user_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.caregivers
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Create function to get patient_id from user_id
CREATE OR REPLACE FUNCTION public.get_patient_id(_user_id UUID)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.patients
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- RLS Policies for user_roles
CREATE POLICY "Users can view own role"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own role"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- RLS Policies for caregivers
CREATE POLICY "Caregivers can view own record"
ON public.caregivers FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Caregivers can insert own record"
ON public.caregivers FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Caregivers can update own record"
ON public.caregivers FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- RLS Policies for patients
CREATE POLICY "Patients can view own record"
ON public.patients FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Caregivers can view their patients"
ON public.patients FOR SELECT
TO authenticated
USING (caregiver_id = public.get_caregiver_id(auth.uid()));

CREATE POLICY "Patients can insert own record"
ON public.patients FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Caregivers can update patient assignment"
ON public.patients FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id OR 
  caregiver_id = public.get_caregiver_id(auth.uid()) OR
  caregiver_id IS NULL
);

-- RLS Policies for geofences
CREATE POLICY "Patients can view own geofence"
ON public.geofences FOR SELECT
TO authenticated
USING (patient_id = public.get_patient_id(auth.uid()));

CREATE POLICY "Caregivers can view patient geofences"
ON public.geofences FOR SELECT
TO authenticated
USING (
  patient_id IN (
    SELECT id FROM public.patients 
    WHERE caregiver_id = public.get_caregiver_id(auth.uid())
  )
);

CREATE POLICY "Caregivers can insert patient geofences"
ON public.geofences FOR INSERT
TO authenticated
WITH CHECK (
  patient_id IN (
    SELECT id FROM public.patients 
    WHERE caregiver_id = public.get_caregiver_id(auth.uid())
  )
);

CREATE POLICY "Caregivers can update patient geofences"
ON public.geofences FOR UPDATE
TO authenticated
USING (
  patient_id IN (
    SELECT id FROM public.patients 
    WHERE caregiver_id = public.get_caregiver_id(auth.uid())
  )
);

-- RLS Policies for location_logs
CREATE POLICY "Patients can view own location logs"
ON public.location_logs FOR SELECT
TO authenticated
USING (patient_id = public.get_patient_id(auth.uid()));

CREATE POLICY "Caregivers can view patient location logs"
ON public.location_logs FOR SELECT
TO authenticated
USING (
  patient_id IN (
    SELECT id FROM public.patients 
    WHERE caregiver_id = public.get_caregiver_id(auth.uid())
  )
);

CREATE POLICY "Patients can insert own location logs"
ON public.location_logs FOR INSERT
TO authenticated
WITH CHECK (patient_id = public.get_patient_id(auth.uid()));

-- RLS Policies for alerts
CREATE POLICY "Patients can view own alerts"
ON public.alerts FOR SELECT
TO authenticated
USING (patient_id = public.get_patient_id(auth.uid()));

CREATE POLICY "Caregivers can view patient alerts"
ON public.alerts FOR SELECT
TO authenticated
USING (
  patient_id IN (
    SELECT id FROM public.patients 
    WHERE caregiver_id = public.get_caregiver_id(auth.uid())
  )
);

CREATE POLICY "Patients can insert own alerts"
ON public.alerts FOR INSERT
TO authenticated
WITH CHECK (patient_id = public.get_patient_id(auth.uid()));

CREATE POLICY "Patients can update own alerts"
ON public.alerts FOR UPDATE
TO authenticated
USING (patient_id = public.get_patient_id(auth.uid()));

CREATE POLICY "Caregivers can update patient alerts"
ON public.alerts FOR UPDATE
TO authenticated
USING (
  patient_id IN (
    SELECT id FROM public.patients 
    WHERE caregiver_id = public.get_caregiver_id(auth.uid())
  )
);

-- Enable realtime for location_logs and alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.location_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_geofences_updated_at
BEFORE UPDATE ON public.geofences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();