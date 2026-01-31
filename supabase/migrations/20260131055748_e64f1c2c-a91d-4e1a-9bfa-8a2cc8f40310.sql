-- Create a function to handle new user signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_role text;
  user_name text;
  user_email text;
BEGIN
  -- Get role from user metadata
  user_role := NEW.raw_user_meta_data->>'role';
  user_name := COALESCE(NEW.raw_user_meta_data->>'name', 'User');
  user_email := COALESCE(NEW.email, '');

  -- Insert profile
  INSERT INTO public.profiles (user_id, name, email)
  VALUES (NEW.id, user_name, user_email);

  -- Handle caregiver role
  IF user_role = 'caregiver' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'caregiver');
    
    INSERT INTO public.caregivers (user_id, name)
    VALUES (NEW.id, user_name);
  
  -- Handle patient role
  ELSIF user_role = 'patient' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'patient');
    
    INSERT INTO public.patients (user_id, name, email)
    VALUES (NEW.id, user_name, user_email);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on auth.users for new signups
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();