-- 1) profiles UPDATE: validar contra la membership real de la org del perfil objetivo
DROP POLICY IF EXISTS "Admins can update org profiles" ON public.profiles;

CREATE POLICY "Admins can update org profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = public.profiles.organization_id
      AND m.role IN ('owner','admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.organization_id = public.profiles.organization_id
      AND m.role IN ('owner','admin')
  )
);

-- 2) storage.objects: políticas explícitas de mutación para cancelaciones-plantillas
DROP POLICY IF EXISTS "Org members can insert cancelaciones-plantillas" ON storage.objects;
DROP POLICY IF EXISTS "Org members can update cancelaciones-plantillas" ON storage.objects;
DROP POLICY IF EXISTS "Org members can delete cancelaciones-plantillas" ON storage.objects;

CREATE POLICY "Org members can insert cancelaciones-plantillas"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cancelaciones-plantillas'
  AND (storage.foldername(name))[1] = public.get_active_org(auth.uid())::text
);

CREATE POLICY "Org members can update cancelaciones-plantillas"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'cancelaciones-plantillas'
  AND (storage.foldername(name))[1] = public.get_active_org(auth.uid())::text
)
WITH CHECK (
  bucket_id = 'cancelaciones-plantillas'
  AND (storage.foldername(name))[1] = public.get_active_org(auth.uid())::text
);

CREATE POLICY "Org members can delete cancelaciones-plantillas"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'cancelaciones-plantillas'
  AND (storage.foldername(name))[1] = public.get_active_org(auth.uid())::text
);