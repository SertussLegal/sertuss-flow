
-- 1) profiles: bloquear mutación de role vía RLS (defensa en profundidad sobre el trigger)
DROP POLICY IF EXISTS "Admins can update org profiles" ON public.profiles;
CREATE POLICY "Admins can update org profiles"
ON public.profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = profiles.organization_id
      AND m.role IN ('owner','admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = profiles.organization_id
      AND m.role IN ('owner','admin')
  )
  AND role = (SELECT p.role FROM public.profiles p WHERE p.id = profiles.id)
  AND organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.id = profiles.id)
);

-- 2) activity_logs: append-only desde el servidor
DROP POLICY IF EXISTS "Users can insert own logs" ON public.activity_logs;
REVOKE INSERT ON public.activity_logs FROM authenticated;

-- 3) cancelaciones: reforzar con membresía explícita (doble predicado)
DROP POLICY IF EXISTS "Users view own org cancelaciones" ON public.cancelaciones;
DROP POLICY IF EXISTS "Users update own org cancelaciones" ON public.cancelaciones;
DROP POLICY IF EXISTS "Users insert own org cancelaciones" ON public.cancelaciones;

CREATE POLICY "Users view own org cancelaciones"
ON public.cancelaciones FOR SELECT
TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.is_org_member(organization_id)
);

CREATE POLICY "Users update own org cancelaciones"
ON public.cancelaciones FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.is_org_member(organization_id)
)
WITH CHECK (
  organization_id = public.get_active_org(auth.uid())
  AND public.is_org_member(organization_id)
);

CREATE POLICY "Users insert own org cancelaciones"
ON public.cancelaciones FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = public.get_active_org(auth.uid())
  AND public.is_org_member(organization_id)
);

-- 4) set_active_context: log de auditoría CONTEXT_SWITCH
CREATE OR REPLACE FUNCTION public.set_active_context(p_org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.org_role;
  v_prev_org uuid;
BEGIN
  SELECT role INTO v_role
  FROM public.memberships
  WHERE user_id = auth.uid() AND organization_id = p_org_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'No membership for this organization';
  END IF;

  SELECT organization_id INTO v_prev_org
  FROM public.user_active_context WHERE user_id = auth.uid();

  INSERT INTO public.user_active_context (user_id, organization_id, updated_at)
  VALUES (auth.uid(), p_org_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        updated_at = now();

  UPDATE public.profiles
  SET organization_id = p_org_id, role = v_role
  WHERE id = auth.uid();

  IF v_prev_org IS DISTINCT FROM p_org_id THEN
    INSERT INTO public.activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
    VALUES (p_org_id, auth.uid(), 'CONTEXT_SWITCH', 'organization', p_org_id,
      jsonb_build_object('from_org', v_prev_org, 'to_org', p_org_id));
  END IF;
END;
$function$;
