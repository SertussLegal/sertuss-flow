REVOKE EXECUTE ON FUNCTION public.next_radicado(uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Owners read own org events" ON public.system_events;
CREATE POLICY "Owners read own org events" ON public.system_events
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org(auth.uid())
    AND public.get_user_role(auth.uid()) = 'owner'::org_role
  );