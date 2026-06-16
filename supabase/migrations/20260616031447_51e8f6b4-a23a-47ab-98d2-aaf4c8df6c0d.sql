
-- 1. profiles SELECT: require explicit membership match
DROP POLICY IF EXISTS "Users can view org members" ON public.profiles;

CREATE POLICY "Users can view org members"
ON public.profiles FOR SELECT TO authenticated
USING (
  organization_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = profiles.organization_id
  )
);

-- 2. cancelaciones-plantillas: restrict writes to owner/admin
DROP POLICY IF EXISTS "Org members can insert cancelaciones-plantillas" ON storage.objects;
DROP POLICY IF EXISTS "Org members can update cancelaciones-plantillas" ON storage.objects;
DROP POLICY IF EXISTS "Org members can delete cancelaciones-plantillas" ON storage.objects;

CREATE POLICY "Org admins can insert cancelaciones-plantillas"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'cancelaciones-plantillas'
  AND (storage.foldername(name))[1] = (public.get_active_org(auth.uid()))::text
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = public.get_active_org(auth.uid())
      AND m.role IN ('owner','admin')
  )
);

CREATE POLICY "Org admins can update cancelaciones-plantillas"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'cancelaciones-plantillas'
  AND (storage.foldername(name))[1] = (public.get_active_org(auth.uid()))::text
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = public.get_active_org(auth.uid())
      AND m.role IN ('owner','admin')
  )
)
WITH CHECK (
  bucket_id = 'cancelaciones-plantillas'
  AND (storage.foldername(name))[1] = (public.get_active_org(auth.uid()))::text
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = public.get_active_org(auth.uid())
      AND m.role IN ('owner','admin')
  )
);

CREATE POLICY "Org admins can delete cancelaciones-plantillas"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'cancelaciones-plantillas'
  AND (storage.foldername(name))[1] = (public.get_active_org(auth.uid()))::text
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = public.get_active_org(auth.uid())
      AND m.role IN ('owner','admin')
  )
);
