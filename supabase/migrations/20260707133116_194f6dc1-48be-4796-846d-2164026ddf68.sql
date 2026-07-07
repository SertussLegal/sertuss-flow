DROP POLICY IF EXISTS "Members read their org cache" ON public.ocr_raw_cache;
CREATE POLICY "Members read their org cache" ON public.ocr_raw_cache
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());