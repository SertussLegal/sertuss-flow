CREATE OR REPLACE FUNCTION public.restore_credit(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.organizations SET credit_balance = credit_balance + 1 WHERE id = org_id;
END;
$$;