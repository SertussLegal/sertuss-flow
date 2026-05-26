-- 1) Platform-admin guard helper
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND lower(email) = 'info@sertuss.com'
  );
$$;

-- 2) Replace org-owner check with platform-admin check in admin RPCs
CREATE OR REPLACE FUNCTION public.get_all_organizations()
 RETURNS TABLE(id uuid, name text, nit character varying, address text, credit_balance integer, debug_tools_enabled boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.nit, o.address, o.credit_balance, o.debug_tools_enabled, o.created_at
    FROM organizations o
    ORDER BY o.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_credits(target_org_id uuid, new_balance integer, reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  old_bal int;
  caller_org uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT credit_balance INTO old_bal FROM organizations WHERE id = target_org_id;
  UPDATE organizations SET credit_balance = new_balance WHERE id = target_org_id;
  caller_org := get_user_org(auth.uid());
  INSERT INTO activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (caller_org, auth.uid(), 'CREDIT_UPDATE', 'organization', target_org_id,
    jsonb_build_object('old_balance', old_bal, 'new_balance', new_balance, 'reason', reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_debug_tools(target_org_id uuid, enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_org uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
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

CREATE OR REPLACE FUNCTION public.admin_update_organization(target_org_id uuid, new_name text, new_nit character varying, new_address text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE organizations
  SET name = new_name, nit = new_nit, address = new_address
  WHERE id = target_org_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_toggle_module(p_org_id uuid, p_slug text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  insert into public.organization_modules(organization_id, module_slug, enabled, enabled_by, enabled_at)
  values (p_org_id, p_slug, p_enabled, auth.uid(), now())
  on conflict (organization_id, module_slug)
    do update set enabled = excluded.enabled,
                  enabled_by = auth.uid(),
                  enabled_at = now();

  insert into public.activity_logs(organization_id, user_id, action, entity_type, entity_id, metadata)
  values (p_org_id, auth.uid(), 'MODULE_TOGGLE', 'organization', p_org_id,
          jsonb_build_object('slug', p_slug, 'enabled', p_enabled));
end;
$function$;

-- 3) Add membership + caller verification to credit RPCs
CREATE OR REPLACE FUNCTION public.consume_credit_v2(p_org_id uuid, p_user_id uuid, p_action text, p_tramite_id uuid DEFAULT NULL::uuid, p_tipo_acto text DEFAULT NULL::text, p_credits integer DEFAULT 1)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_balance integer;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: not a member of organization';
  END IF;

  SELECT credit_balance INTO current_balance
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF current_balance IS NULL OR current_balance < p_credits THEN
    RETURN false;
  END IF;

  UPDATE public.organizations
  SET credit_balance = credit_balance - p_credits
  WHERE id = p_org_id;

  INSERT INTO public.credit_consumption (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, p_action, p_credits, p_tipo_acto);

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unlock_expediente(p_org_id uuid, p_tramite_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_balance integer;
  v_tipo_acto text;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: user mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: not a member of organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tramites
    WHERE id = p_tramite_id AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: tramite does not belong to organization';
  END IF;

  SELECT credit_balance INTO current_balance
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;

  IF current_balance IS NULL OR current_balance < 2 THEN
    RETURN false;
  END IF;

  UPDATE public.organizations SET credit_balance = credit_balance - 2 WHERE id = p_org_id;

  UPDATE public.tramites SET is_unlocked = true WHERE id = p_tramite_id;

  SELECT tipo INTO v_tipo_acto FROM public.tramites WHERE id = p_tramite_id;

  INSERT INTO public.credit_consumption (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, 'APERTURA_EXPEDIENTE', 2, v_tipo_acto);

  INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (p_org_id, p_user_id, 'APERTURA_EXPEDIENTE', 'tramite', p_tramite_id,
    jsonb_build_object('credits_consumed', 2, 'old_balance', current_balance, 'new_balance', current_balance - 2));

  RETURN true;
END;
$function$;

-- 4) Lock down restore_credit
CREATE OR REPLACE FUNCTION public.restore_credit(org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid()
      AND organization_id = org_id
      AND role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE public.organizations SET credit_balance = credit_balance + 1 WHERE id = org_id;
END;
$function$;

-- 5) Revoke broad EXECUTE; grant only to authenticated where appropriate
REVOKE EXECUTE ON FUNCTION public.restore_credit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_credit(uuid) TO authenticated;