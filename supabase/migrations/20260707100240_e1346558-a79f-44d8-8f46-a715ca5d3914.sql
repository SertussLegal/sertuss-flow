-- BLOQUE 1 · tramites
DROP POLICY "Users can view org tramites" ON public.tramites;
CREATE POLICY "Users can view org tramites"
ON public.tramites FOR SELECT TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND (
    get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
    OR created_by = auth.uid()
  )
);

DROP POLICY "Users can update org tramites" ON public.tramites;
CREATE POLICY "Users can update org tramites"
ON public.tramites FOR UPDATE TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND (
    get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
    OR created_by = auth.uid()
  )
);

DROP POLICY "Users can delete own draft tramites" ON public.tramites;
CREATE POLICY "Users can delete own draft tramites"
ON public.tramites FOR DELETE TO authenticated
USING (
  status = 'pendiente'::tramite_status
  AND organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND (
    get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
    OR created_by = auth.uid()
  )
);

DROP POLICY "Users can insert org tramites" ON public.tramites;
CREATE POLICY "Users can insert org tramites"
ON public.tramites FOR INSERT TO authenticated
WITH CHECK (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
);

-- BLOQUE 2 · configuracion_notaria
DROP POLICY "Users can view own org config" ON public.configuracion_notaria;
CREATE POLICY "Users can view own org config"
ON public.configuracion_notaria FOR SELECT TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
);

DROP POLICY "Admins can manage own org config" ON public.configuracion_notaria;
CREATE POLICY "Admins can manage own org config"
ON public.configuracion_notaria FOR ALL TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
)
WITH CHECK (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
);

-- BLOQUE 3 · notaria_styles
DROP POLICY "Users can view own org styles" ON public.notaria_styles;
CREATE POLICY "Users can view own org styles"
ON public.notaria_styles FOR SELECT TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
);

DROP POLICY "Admins can manage styles" ON public.notaria_styles;
CREATE POLICY "Admins can manage styles"
ON public.notaria_styles FOR ALL TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
)
WITH CHECK (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
);

-- BLOQUE 4 · logs_extraccion
DROP POLICY "Users can view own org logs_extraccion" ON public.logs_extraccion;
CREATE POLICY "Users can view own org logs_extraccion"
ON public.logs_extraccion FOR SELECT TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = get_active_org(auth.uid())
      AND (get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
           OR t.created_by = auth.uid())
  )
);

DROP POLICY "Users can update own org logs_extraccion" ON public.logs_extraccion;
CREATE POLICY "Users can update own org logs_extraccion"
ON public.logs_extraccion FOR UPDATE TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = get_active_org(auth.uid())
      AND (get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
           OR t.created_by = auth.uid())
  )
)
WITH CHECK (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = get_active_org(auth.uid())
      AND (get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
           OR t.created_by = auth.uid())
  )
);

DROP POLICY "Users can insert own org logs_extraccion" ON public.logs_extraccion;
CREATE POLICY "Users can insert own org logs_extraccion"
ON public.logs_extraccion FOR INSERT TO authenticated
WITH CHECK (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND EXISTS (
    SELECT 1 FROM tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = get_active_org(auth.uid())
      AND (get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
           OR t.created_by = auth.uid())
  )
);

-- BLOQUE 5 · historial_validaciones
DROP POLICY "Users can view own org validation history" ON public.historial_validaciones;
CREATE POLICY "Users can view own org validation history"
ON public.historial_validaciones FOR SELECT TO authenticated
USING (
  organization_id = get_active_org(auth.uid())
  AND is_org_member(organization_id)
  AND (
    get_user_role(auth.uid()) = ANY (ARRAY['owner'::org_role,'admin'::org_role])
    OR EXISTS (
      SELECT 1 FROM tramites t
      WHERE t.id = historial_validaciones.tramite_id
        AND t.created_by = auth.uid()
    )
  )
);

-- BLOQUE 6 · credit_consumption
DROP POLICY "Service role inserts consumption" ON public.credit_consumption;
CREATE POLICY "Service role inserts consumption"
ON public.credit_consumption FOR INSERT TO service_role
WITH CHECK (
  organization_id IS NOT NULL
  AND user_id IS NOT NULL
  AND action IS NOT NULL
  AND credits IS NOT NULL
  AND credits > 0
);

CREATE POLICY "No updates on credit_consumption"
ON public.credit_consumption FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);

CREATE POLICY "No deletes on credit_consumption"
ON public.credit_consumption FOR DELETE TO authenticated
USING (false);