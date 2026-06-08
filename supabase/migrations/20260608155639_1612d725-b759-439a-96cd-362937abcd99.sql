-- Lock down cancelaciones-plantillas bucket: only service_role (edge functions) should access.
-- Templates are shared global assets accessed exclusively by procesar-cancelacion edge function.
-- Removing user-facing policies eliminates cross-organization read/write risk.

DROP POLICY IF EXISTS "Owners read cancelaciones plantillas" ON storage.objects;
DROP POLICY IF EXISTS "Owners upload cancelaciones plantillas" ON storage.objects;
DROP POLICY IF EXISTS "Owners update cancelaciones plantillas" ON storage.objects;
DROP POLICY IF EXISTS "Owners delete cancelaciones plantillas" ON storage.objects;

-- Only platform admins can manage templates from the client; edge functions use service_role and bypass RLS.
CREATE POLICY "Platform admins manage cancelaciones plantillas"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'cancelaciones-plantillas' AND public.is_platform_admin())
  WITH CHECK (bucket_id = 'cancelaciones-plantillas' AND public.is_platform_admin());
