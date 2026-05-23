
-- 1) Memberships: prevent privilege escalation via self-insert
DROP POLICY IF EXISTS "Users insert own memberships" ON public.memberships;
-- No client-side INSERT policy. Memberships are created by:
--   * handle_new_user() trigger (SECURITY DEFINER) for personal orgs
--   * accept_invitation() RPC (SECURITY DEFINER) for invited orgs
--   * admin_* functions / service role

-- Also allow org admins to manage (insert/update) memberships of their org
CREATE POLICY "Admins manage org memberships"
ON public.memberships
FOR INSERT
TO authenticated
WITH CHECK (public.is_org_admin(organization_id) AND is_personal = false);

CREATE POLICY "Admins update org memberships"
ON public.memberships
FOR UPDATE
TO authenticated
USING (public.is_org_admin(organization_id) AND is_personal = false)
WITH CHECK (public.is_org_admin(organization_id) AND is_personal = false);

-- 2) user_active_context: restrict to organizations where user has a membership
DROP POLICY IF EXISTS "Users manage own active context" ON public.user_active_context;

CREATE POLICY "Users read own active context"
ON public.user_active_context
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users insert own active context to member org"
ON public.user_active_context
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid() AND m.organization_id = user_active_context.organization_id
  )
);

CREATE POLICY "Users update own active context to member org"
ON public.user_active_context
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid() AND m.organization_id = user_active_context.organization_id
  )
);

CREATE POLICY "Users delete own active context"
ON public.user_active_context
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- 3) Storage policies for cancelaciones-plantillas (private bucket)
CREATE POLICY "Authenticated read cancelaciones plantillas"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'cancelaciones-plantillas');

CREATE POLICY "Owners upload cancelaciones plantillas"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cancelaciones-plantillas'
  AND public.get_user_role(auth.uid()) = 'owner'
);

CREATE POLICY "Owners update cancelaciones plantillas"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'cancelaciones-plantillas'
  AND public.get_user_role(auth.uid()) = 'owner'
)
WITH CHECK (
  bucket_id = 'cancelaciones-plantillas'
  AND public.get_user_role(auth.uid()) = 'owner'
);

CREATE POLICY "Owners delete cancelaciones plantillas"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'cancelaciones-plantillas'
  AND public.get_user_role(auth.uid()) = 'owner'
);

-- 4) Fix mutable search_path on enforce_credit_tramite
CREATE OR REPLACE FUNCTION public.enforce_credit_tramite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tramite_id IS NULL AND COALESCE(NEW.action, '') <> 'LEGACY' THEN
    RAISE EXCEPTION 'credit_consumption requires tramite_id (action=%)', NEW.action;
  END IF;
  RETURN NEW;
END;
$function$;
