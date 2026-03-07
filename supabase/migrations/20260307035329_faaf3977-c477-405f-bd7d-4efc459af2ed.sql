CREATE POLICY "Authenticated users can insert organizations"
ON public.organizations
FOR INSERT
TO authenticated
WITH CHECK (true);