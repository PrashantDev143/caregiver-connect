-- Resolve PostgREST RPC ambiguity by removing legacy 6-arg overload.
-- Keep only the 8-arg function with OCR/final-score fields.

DROP FUNCTION IF EXISTS public.record_pill_attempt(
  uuid,
  uuid,
  text,
  text,
  numeric,
  text
);

GRANT EXECUTE ON FUNCTION public.record_pill_attempt(
  uuid,
  uuid,
  text,
  text,
  numeric,
  text,
  numeric,
  numeric
) TO authenticated;
