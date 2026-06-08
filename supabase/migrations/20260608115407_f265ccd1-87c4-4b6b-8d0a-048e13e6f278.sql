DROP POLICY IF EXISTS "owners read all modules" ON public.organization_modules;
DROP POLICY IF EXISTS "Owners can read all events" ON public.system_events;
CREATE POLICY "Owners read own org events" ON public.system_events
  FOR SELECT USING (organization_id = public.get_user_org(auth.uid()) AND public.get_user_role(auth.uid()) = 'owner'::org_role);