-- Add debug_tools_enabled column to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS debug_tools_enabled boolean NOT NULL DEFAULT false;

-- Refresh get_all_organizations to include the new column
CREATE OR REPLACE FUNCTION public.get_all_organizations()
 RETURNS TABLE(id uuid, name text, nit character varying, address text, credit_balance integer, debug_tools_enabled boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.nit, o.address, o.credit_balance, o.debug_tools_enabled, o.created_at
    FROM organizations o
    ORDER BY o.created_at DESC;
END;
$function$;

-- Sertuss-only toggle, with audit log
CREATE OR REPLACE FUNCTION public.admin_set_debug_tools(target_org_id uuid, enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_org uuid;
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.organizations
  SET debug_tools_enabled = enabled
  WHERE id = target_org_id;

  caller_org := get_user_org(auth.uid());

  INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (caller_org, auth.uid(), 'DEBUG_TOOLS_TOGGLE', 'organization', target_org_id,
    jsonb_build_object('enabled', enabled));
END;
$function$;