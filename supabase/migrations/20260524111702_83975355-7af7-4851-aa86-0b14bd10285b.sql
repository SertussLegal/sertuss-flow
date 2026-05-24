
-- 1) Remove profiles.role fallback from get_user_role
CREATE OR REPLACE FUNCTION public.get_user_role(uid uuid)
RETURNS org_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT m.role
       FROM public.memberships m
       JOIN public.user_active_context c ON c.organization_id = m.organization_id
      WHERE m.user_id = uid AND c.user_id = uid
      LIMIT 1),
    (SELECT m.role FROM public.memberships m WHERE m.user_id = uid AND m.is_personal = true LIMIT 1)
  );
$function$;

-- 2) Block self-escalation via profiles.role
CREATE OR REPLACE FUNCTION public.prevent_profile_role_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Only owners/admins of the target user's org can change roles
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = auth.uid()
        AND m.organization_id = OLD.organization_id
        AND m.role IN ('owner','admin')
    ) THEN
      RAISE EXCEPTION 'Not allowed to change role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_role_self_update ON public.profiles;
CREATE TRIGGER trg_prevent_profile_role_self_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_role_self_update();

-- 3) Tighten system_events INSERT policy
DROP POLICY IF EXISTS "Users can insert own org events" ON public.system_events;
CREATE POLICY "Users can insert own org events"
ON public.system_events
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = get_user_org(auth.uid())
  AND (user_id IS NULL OR user_id = auth.uid())
  AND (
    tramite_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = tramite_id
        AND t.organization_id = get_user_org(auth.uid())
    )
  )
);
