DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Admins can update org profiles'
  ) THEN
    CREATE POLICY "Admins can update org profiles"
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (
        organization_id = public.get_active_org(auth.uid())
        AND public.get_user_role(auth.uid()) IN ('owner', 'admin')
      )
      WITH CHECK (
        organization_id = public.get_active_org(auth.uid())
        AND public.get_user_role(auth.uid()) IN ('owner', 'admin')
      );
  END IF;
END $$;