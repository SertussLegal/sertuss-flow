
DROP POLICY IF EXISTS "Authenticated users can insert organizations" ON public.organizations;

CREATE POLICY "Authenticated users can insert organizations"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (
  (credit_balance IS NULL OR credit_balance <= 5)
  AND (debug_tools_enabled IS NULL OR debug_tools_enabled = false)
);
