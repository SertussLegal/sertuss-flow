
CREATE OR REPLACE FUNCTION public.restore_credit(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Service-role only: auth.uid() es NULL cuando la llamada proviene de una edge function
  -- usando SUPABASE_SERVICE_ROLE_KEY. Cualquier llamada desde el cliente (con JWT de usuario)
  -- queda bloqueada para impedir auto-provisión de créditos.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'restore_credit can only be invoked from server-side (service role) context';
  END IF;

  UPDATE public.organizations
  SET credit_balance = credit_balance + 1
  WHERE id = org_id;

  INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (org_id, NULL, 'CREDIT_RESTORE', 'organization', org_id,
    jsonb_build_object('source', 'service_role', 'credits', 1));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.restore_credit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_credit(uuid) TO service_role;
