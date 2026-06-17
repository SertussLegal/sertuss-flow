
-- 1) create_organization_for_user: caller identity guard
CREATE OR REPLACE FUNCTION public.create_organization_for_user(
  p_user_id uuid, p_org_name text, p_org_nit varchar
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  new_org_id uuid;
  existing_org_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: no session';
  END IF;
  IF p_user_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'Unauthorized: user mismatch';
  END IF;

  SELECT organization_id INTO existing_org_id FROM public.profiles WHERE id = v_caller;
  IF existing_org_id IS NOT NULL THEN
    RETURN existing_org_id;
  END IF;

  INSERT INTO public.organizations (name, nit)
  VALUES (COALESCE(NULLIF(TRIM(p_org_name), ''), 'Organizacion001'),
          NULLIF(TRIM(p_org_nit), ''))
  RETURNING id INTO new_org_id;

  UPDATE public.profiles
  SET organization_id = new_org_id, role = 'owner'
  WHERE id = v_caller;

  RETURN new_org_id;
END;
$$;

-- 2) Standardize get_user_org -> get_active_org across all RLS policies

-- activity_logs
DROP POLICY IF EXISTS "Admins can view org logs" ON public.activity_logs;
CREATE POLICY "Admins can view org logs" ON public.activity_logs
FOR SELECT TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
);

-- actos
DROP POLICY IF EXISTS "Users can delete actos" ON public.actos;
CREATE POLICY "Users can delete actos" ON public.actos
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = actos.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can manage actos" ON public.actos;
CREATE POLICY "Users can manage actos" ON public.actos
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = actos.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = actos.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
);

-- configuracion_notaria
DROP POLICY IF EXISTS "Admins can manage own org config" ON public.configuracion_notaria;
CREATE POLICY "Admins can manage own org config" ON public.configuracion_notaria
FOR ALL TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
)
WITH CHECK (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
);

DROP POLICY IF EXISTS "Users can view own org config" ON public.configuracion_notaria;
CREATE POLICY "Users can view own org config" ON public.configuracion_notaria
FOR SELECT TO authenticated
USING (organization_id = public.get_active_org(auth.uid()));

-- historial_validaciones
DROP POLICY IF EXISTS "Users can view own org validation history" ON public.historial_validaciones;
CREATE POLICY "Users can view own org validation history" ON public.historial_validaciones
FOR SELECT TO authenticated
USING (organization_id = public.get_active_org(auth.uid()));

-- inmuebles
DROP POLICY IF EXISTS "Users can delete inmuebles" ON public.inmuebles;
CREATE POLICY "Users can delete inmuebles" ON public.inmuebles
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = inmuebles.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can manage inmuebles" ON public.inmuebles;
CREATE POLICY "Users can manage inmuebles" ON public.inmuebles
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = inmuebles.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = inmuebles.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
);

-- invitations
DROP POLICY IF EXISTS "Admins can manage invitations" ON public.invitations;
CREATE POLICY "Admins can manage invitations" ON public.invitations
FOR ALL TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
)
WITH CHECK (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
);

-- logs_extraccion
DROP POLICY IF EXISTS "Users can manage own org logs_extraccion" ON public.logs_extraccion;
CREATE POLICY "Users can manage own org logs_extraccion" ON public.logs_extraccion
FOR ALL TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
)
WITH CHECK (
  organization_id = public.get_active_org(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = logs_extraccion.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
);

-- notaria_styles
DROP POLICY IF EXISTS "Admins can manage styles" ON public.notaria_styles;
CREATE POLICY "Admins can manage styles" ON public.notaria_styles
FOR ALL TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
)
WITH CHECK (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
);

DROP POLICY IF EXISTS "Users can view own org styles" ON public.notaria_styles;
CREATE POLICY "Users can view own org styles" ON public.notaria_styles
FOR SELECT TO authenticated
USING (organization_id = public.get_active_org(auth.uid()));

-- organizations
DROP POLICY IF EXISTS "Owners can update org" ON public.organizations;
CREATE POLICY "Owners can update org" ON public.organizations
FOR UPDATE TO authenticated
USING (
  id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) = 'owner'
);

-- personas
DROP POLICY IF EXISTS "Users can delete personas" ON public.personas;
CREATE POLICY "Users can delete personas" ON public.personas
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = personas.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users can manage personas" ON public.personas;
CREATE POLICY "Users can manage personas" ON public.personas
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = personas.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.tramites t
    WHERE t.id = personas.tramite_id
      AND t.organization_id = public.get_active_org(auth.uid())
      AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
  )
);

-- tramites
DROP POLICY IF EXISTS "Users can delete own draft tramites" ON public.tramites;
CREATE POLICY "Users can delete own draft tramites" ON public.tramites
FOR DELETE TO authenticated
USING (
  status = 'pendiente'::tramite_status
  AND organization_id = public.get_active_org(auth.uid())
  AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR created_by = auth.uid())
);

DROP POLICY IF EXISTS "Users can insert org tramites" ON public.tramites;
CREATE POLICY "Users can insert org tramites" ON public.tramites
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.get_active_org(auth.uid()));

DROP POLICY IF EXISTS "Users can update org tramites" ON public.tramites;
CREATE POLICY "Users can update org tramites" ON public.tramites
FOR UPDATE TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR created_by = auth.uid())
);

DROP POLICY IF EXISTS "Users can view org tramites" ON public.tramites;
CREATE POLICY "Users can view org tramites" ON public.tramites
FOR SELECT TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR created_by = auth.uid())
);

-- 3) system_events: consolidar las dos políticas de lectura en una sola
DROP POLICY IF EXISTS "Admins can read own org events" ON public.system_events;
DROP POLICY IF EXISTS "Owners read own org events" ON public.system_events;
CREATE POLICY "Owners and admins read own org events" ON public.system_events
FOR SELECT TO authenticated
USING (
  organization_id = public.get_active_org(auth.uid())
  AND public.get_user_role(auth.uid()) IN ('owner','admin')
);
