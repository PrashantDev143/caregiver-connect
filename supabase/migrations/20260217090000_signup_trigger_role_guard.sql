-- Ensure signup trigger always persists role/profile rows without enum cast failures.
-- Safe patch only; no schema/table changes.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role_val app_role;
  meta_role text;
  display_name text;
BEGIN
  meta_role := NEW.raw_user_meta_data->>'role';
  display_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), 'User');

  IF meta_role IN ('caregiver', 'patient') THEN
    role_val := meta_role::app_role;
  ELSE
    role_val := 'patient'::app_role;
  END IF;

  INSERT INTO public.profiles (user_id, email, name)
  VALUES (NEW.id, COALESCE(NEW.email, ''), display_name)
  ON CONFLICT (user_id) DO UPDATE
  SET email = EXCLUDED.email,
      name = EXCLUDED.name;

  DELETE FROM public.user_roles WHERE user_id = NEW.id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, role_val);

  IF role_val = 'caregiver' THEN
    INSERT INTO public.caregivers (user_id, name)
    VALUES (NEW.id, display_name)
    ON CONFLICT (user_id) DO UPDATE
    SET name = EXCLUDED.name;
  ELSE
    INSERT INTO public.patients (user_id, name, email)
    VALUES (NEW.id, display_name, COALESCE(NEW.email, ''))
    ON CONFLICT (user_id) DO UPDATE
    SET name = EXCLUDED.name,
        email = EXCLUDED.email;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can update own role" ON public.user_roles;

CREATE POLICY "Users can view own role"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own role"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own role"
ON public.user_roles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
