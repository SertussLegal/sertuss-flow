-- Allow users to delete their own pendiente tramites (drafts)
CREATE POLICY "Users can delete own draft tramites"
ON public.tramites
FOR DELETE
TO authenticated
USING (
  status = 'pendiente'
  AND organization_id = get_user_org(auth.uid())
  AND (
    get_user_role(auth.uid()) IN ('owner', 'admin')
    OR created_by = auth.uid()
  )
);

-- Allow deleting related data for draft tramites
CREATE POLICY "Users can delete personas"
ON public.personas
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = personas.tramite_id
    AND t.organization_id = get_user_org(auth.uid())
    AND (get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
  )
);

CREATE POLICY "Users can delete inmuebles"
ON public.inmuebles
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = inmuebles.tramite_id
    AND t.organization_id = get_user_org(auth.uid())
    AND (get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
  )
);

CREATE POLICY "Users can delete actos"
ON public.actos
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = actos.tramite_id
    AND t.organization_id = get_user_org(auth.uid())
    AND (get_user_role(auth.uid()) IN ('owner', 'admin') OR t.created_by = auth.uid())
  )
);