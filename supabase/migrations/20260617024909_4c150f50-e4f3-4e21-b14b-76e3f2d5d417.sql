DROP POLICY IF EXISTS "Users can view own org validation history" ON public.historial_validaciones;

CREATE POLICY "Users can view own org validation history"
ON public.historial_validaciones
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND (
    public.get_user_role(auth.uid()) = ANY (ARRAY['owner'::public.org_role, 'admin'::public.org_role])
    OR EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = historial_validaciones.tramite_id
        AND t.created_by = auth.uid()
    )
  )
);