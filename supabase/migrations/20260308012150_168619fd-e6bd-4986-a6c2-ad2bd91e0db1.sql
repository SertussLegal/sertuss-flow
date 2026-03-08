
CREATE OR REPLACE FUNCTION public.get_all_organizations()
RETURNS TABLE(id uuid, name text, nit varchar, address text, credit_balance int, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY SELECT o.id, o.name, o.nit, o.address, o.credit_balance, o.created_at FROM organizations o ORDER BY o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_credits(target_org_id uuid, new_balance int, reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  old_bal int;
  caller_org uuid;
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT credit_balance INTO old_bal FROM organizations WHERE id = target_org_id;
  UPDATE organizations SET credit_balance = new_balance WHERE id = target_org_id;
  caller_org := get_user_org(auth.uid());
  INSERT INTO activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (caller_org, auth.uid(), 'CREDIT_UPDATE', 'organization', target_org_id,
    jsonb_build_object('old_balance', old_bal, 'new_balance', new_balance, 'reason', reason));
END;
$$;
