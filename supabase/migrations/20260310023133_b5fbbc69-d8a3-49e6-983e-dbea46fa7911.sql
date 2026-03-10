
ALTER TABLE public.tramites ADD COLUMN is_unlocked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.unlock_expediente(p_org_id uuid, p_tramite_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_balance integer;
BEGIN
  -- Lock the org row and check balance
  SELECT credit_balance INTO current_balance
  FROM organizations WHERE id = p_org_id FOR UPDATE;

  IF current_balance IS NULL OR current_balance < 2 THEN
    RETURN false;
  END IF;

  -- Deduct 2 credits
  UPDATE organizations SET credit_balance = credit_balance - 2 WHERE id = p_org_id;

  -- Mark tramite as unlocked
  UPDATE tramites SET is_unlocked = true WHERE id = p_tramite_id;

  -- Log the action
  INSERT INTO activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (p_org_id, p_user_id, 'APERTURA_EXPEDIENTE', 'tramite', p_tramite_id,
    jsonb_build_object('credits_consumed', 2, 'old_balance', current_balance, 'new_balance', current_balance - 2));

  RETURN true;
END;
$$;
