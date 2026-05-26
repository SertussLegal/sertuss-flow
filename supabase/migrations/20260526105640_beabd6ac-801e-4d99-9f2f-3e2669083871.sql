-- Fix 1: Restrict read access to cancelaciones-plantillas bucket to owners only
-- (Templates are read server-side via edge functions with the service role; clients don't need direct read access)
DROP POLICY IF EXISTS "Authenticated read cancelaciones plantillas" ON storage.objects;

CREATE POLICY "Owners read cancelaciones plantillas"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'cancelaciones-plantillas'
  AND get_user_role(auth.uid()) = 'owner'::public.org_role
);

-- Fix 2: Defense-in-depth at RLS layer to prevent role/organization self-escalation on profiles
-- The trigger prevent_profile_role_self_update already enforces this, but we add a WITH CHECK
-- so privilege escalation is blocked at the RLS layer independently of the trigger.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
  AND organization_id IS NOT DISTINCT FROM (SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid())
);