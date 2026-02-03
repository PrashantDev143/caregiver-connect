-- Enable realtime for location_logs so caregivers see live patient location updates.
-- RLS is already enabled; policies allow patient insert and caregiver select.
ALTER PUBLICATION supabase_realtime ADD TABLE public.location_logs;
