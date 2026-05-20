
-- Helper: ¿es admin/owner de la organización?
CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid()
      AND organization_id = p_org_id
      AND role IN ('owner','admin')
  );
$$;

-- Helper: ¿es miembro de la organización?
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid()
      AND organization_id = p_org_id
  );
$$;

-- Reemplazar políticas recursivas en memberships
DROP POLICY IF EXISTS "Org admins see all memberships of their orgs" ON public.memberships;
DROP POLICY IF EXISTS "Admins can revoke org memberships" ON public.memberships;

CREATE POLICY "Org admins see all memberships of their orgs"
ON public.memberships
FOR SELECT
TO authenticated
USING (public.is_org_admin(organization_id));

CREATE POLICY "Admins can revoke org memberships"
ON public.memberships
FOR DELETE
TO authenticated
USING (
  is_personal = false
  AND user_id <> auth.uid()
  AND public.is_org_admin(organization_id)
);

-- Ampliar lectura de organizations: cualquier miembro puede leer todas sus orgs
DROP POLICY IF EXISTS "Users can view own org" ON public.organizations;

CREATE POLICY "Members can view their organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (public.is_org_member(id));
