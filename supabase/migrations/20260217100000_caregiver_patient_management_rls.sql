-- Caregiver patient management RLS patch:
-- - allow caregivers to find unassigned patients (for add flow)
-- - allow caregivers to claim unassigned patients
-- - allow caregivers to unassign their own patients (delete feature = unlink)

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Caregivers can find unassigned patients" ON public.patients;
CREATE POLICY "Caregivers can find unassigned patients"
ON public.patients
FOR SELECT
TO authenticated
USING (
  caregiver_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Caregivers can claim unassigned patients" ON public.patients;
CREATE POLICY "Caregivers can claim unassigned patients"
ON public.patients
FOR UPDATE
TO authenticated
USING (
  caregiver_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
  )
)
WITH CHECK (
  caregiver_id = (
    SELECT c.id
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "Caregivers can unassign own patients" ON public.patients;
CREATE POLICY "Caregivers can unassign own patients"
ON public.patients
FOR UPDATE
TO authenticated
USING (
  caregiver_id = (
    SELECT c.id
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
    LIMIT 1
  )
)
WITH CHECK (
  caregiver_id IS NULL
  OR caregiver_id = (
    SELECT c.id
    FROM public.caregivers c
    WHERE c.user_id = auth.uid()
    LIMIT 1
  )
);
