-- Add OCR/text-enhanced similarity tracking to pill_logs and attempt history.
-- Safe additive migration: keeps existing image score field and existing storage/model behavior.

ALTER TABLE public.pill_logs
  ADD COLUMN IF NOT EXISTS text_similarity_score numeric,
  ADD COLUMN IF NOT EXISTS final_similarity_score numeric;

DO $$
BEGIN
  IF to_regclass('public.medicine_verification_attempts') IS NOT NULL THEN
    EXECUTE '
      ALTER TABLE public.medicine_verification_attempts
        ADD COLUMN IF NOT EXISTS text_similarity_score numeric,
        ADD COLUMN IF NOT EXISTS final_similarity_score numeric
    ';
  END IF;
END $$;

ALTER TABLE public.pill_logs
  DROP CONSTRAINT IF EXISTS pill_logs_text_similarity_score_range,
  ADD CONSTRAINT pill_logs_text_similarity_score_range
    CHECK (text_similarity_score IS NULL OR (text_similarity_score >= 0 AND text_similarity_score <= 1)),
  DROP CONSTRAINT IF EXISTS pill_logs_final_similarity_score_range,
  ADD CONSTRAINT pill_logs_final_similarity_score_range
    CHECK (final_similarity_score IS NULL OR (final_similarity_score >= 0 AND final_similarity_score <= 1));

DO $$
BEGIN
  IF to_regclass('public.medicine_verification_attempts') IS NOT NULL THEN
    EXECUTE '
      ALTER TABLE public.medicine_verification_attempts
        DROP CONSTRAINT IF EXISTS medicine_verification_attempts_text_similarity_score_range,
        ADD CONSTRAINT medicine_verification_attempts_text_similarity_score_range
          CHECK (text_similarity_score IS NULL OR (text_similarity_score >= 0 AND text_similarity_score <= 1)),
        DROP CONSTRAINT IF EXISTS medicine_verification_attempts_final_similarity_score_range,
        ADD CONSTRAINT medicine_verification_attempts_final_similarity_score_range
          CHECK (final_similarity_score IS NULL OR (final_similarity_score >= 0 AND final_similarity_score <= 1))
    ';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_pill_attempt(
  _patient_id uuid,
  _caregiver_id uuid,
  _medicine_id text,
  _time_of_day text,
  _similarity_score numeric,
  _verification_status text,
  _text_similarity_score numeric DEFAULT NULL,
  _final_similarity_score numeric DEFAULT NULL
)
RETURNS TABLE(consecutive_failed_attempts integer, notify_caregiver boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_patient_owner boolean;
  v_counter public.pill_attempt_counters%ROWTYPE;
  v_failed integer := 0;
  v_notify boolean := false;
BEGIN
  IF _time_of_day NOT IN ('morning', 'afternoon', 'evening') THEN
    RAISE EXCEPTION 'invalid time_of_day';
  END IF;

  IF _verification_status NOT IN ('success', 'failed') THEN
    RAISE EXCEPTION 'invalid verification_status';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.patients p
    WHERE p.id = _patient_id
      AND p.user_id = auth.uid()
      AND p.caregiver_id = _caregiver_id
  )
  INTO v_is_patient_owner;

  IF NOT v_is_patient_owner THEN
    RAISE EXCEPTION 'not authorized for patient';
  END IF;

  INSERT INTO public.pill_logs (
    patient_id,
    caregiver_id,
    medicine_id,
    time_of_day,
    verification_status,
    similarity_score,
    text_similarity_score,
    final_similarity_score
  )
  VALUES (
    _patient_id,
    _caregiver_id,
    _medicine_id,
    _time_of_day,
    _verification_status,
    _similarity_score,
    _text_similarity_score,
    COALESCE(_final_similarity_score, _similarity_score)
  );

  INSERT INTO public.pill_attempt_counters (patient_id, caregiver_id, medicine_id)
  VALUES (_patient_id, _caregiver_id, _medicine_id)
  ON CONFLICT (patient_id, medicine_id) DO NOTHING;

  SELECT *
  INTO v_counter
  FROM public.pill_attempt_counters
  WHERE patient_id = _patient_id
    AND medicine_id = _medicine_id
  FOR UPDATE;

  IF _verification_status = 'success' THEN
    UPDATE public.pill_attempt_counters
    SET consecutive_failed_attempts = 0,
        last_attempt_at = now(),
        last_success_at = now(),
        alert_sent_at = NULL,
        updated_at = now()
    WHERE id = v_counter.id
    RETURNING consecutive_failed_attempts INTO v_failed;
    v_notify := false;
  ELSE
    v_failed := COALESCE(v_counter.consecutive_failed_attempts, 0) + 1;
    v_notify := (v_failed >= 10 AND v_counter.alert_sent_at IS NULL);

    UPDATE public.pill_attempt_counters
    SET consecutive_failed_attempts = v_failed,
        last_attempt_at = now(),
        alert_sent_at = CASE
          WHEN v_notify THEN now()
          ELSE v_counter.alert_sent_at
        END,
        updated_at = now()
    WHERE id = v_counter.id;
  END IF;

  RETURN QUERY SELECT v_failed, v_notify;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_pill_attempt(uuid, uuid, text, text, numeric, text, numeric, numeric) TO authenticated;
