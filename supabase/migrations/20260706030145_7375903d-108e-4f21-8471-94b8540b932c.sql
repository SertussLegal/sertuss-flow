-- =============================================================================
-- Migración: Endurecimiento y documentación de RLS en tablas críticas
-- Alcance: cancelaciones, organizations, logs_extraccion, personas, tramites
-- Basado en el diagnóstico "Diagnóstico — RLS de cancelaciones, personas,
-- organizations" y decisiones confirmadas por el dueño del producto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) CANCELACIONES: sin DELETE, de forma explícita e intencional
-- -----------------------------------------------------------------------------
-- El GRANT DELETE quedó otorgado en migración 20260621; RLS lo bloqueaba
-- silenciosamente por ausencia de policy. Lo revocamos para dejarlo explícito
-- también a nivel de privilegios SQL.
REVOKE DELETE ON public.cancelaciones FROM authenticated;

COMMENT ON TABLE public.cancelaciones IS
  'Registro notarial. No se permite DELETE por decisión de negocio: se requiere '
  'trazabilidad completa del historial de cancelaciones. Solo service_role puede '
  'eliminar, y no se invoca desde ninguna función de la aplicación.';

-- -----------------------------------------------------------------------------
-- 2) ORGANIZATIONS: cerrar INSERT directo por Data API
-- -----------------------------------------------------------------------------
-- Toda creación legítima debe pasar por el RPC public.create_organization_for_user
-- (SECURITY DEFINER — verificado en el catálogo actual), que valida nombre/NIT,
-- crea la membresía del creador y la organización personal si aplica.
DROP POLICY IF EXISTS "Authenticated users can insert organizations" ON public.organizations;

CREATE POLICY "Block direct organization inserts"
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

COMMENT ON POLICY "Block direct organization inserts" ON public.organizations IS
  'Bloquea cualquier INSERT directo desde el cliente. Toda creación de organización '
  'debe pasar por el RPC public.create_organization_for_user (SECURITY DEFINER), '
  'que valida datos y crea la membresía del creador de forma atómica.';

-- -----------------------------------------------------------------------------
-- 3) LOGS_EXTRACCION: dividir ALL en SELECT/INSERT/UPDATE, sin DELETE
-- -----------------------------------------------------------------------------
-- La policy actual ALL permitía DELETE a admin/owner o creador del trámite; se
-- elimina esa capacidad para preservar evidencia OCR. Solo service_role borra.
DROP POLICY IF EXISTS "Users can manage own org logs_extraccion" ON public.logs_extraccion;

CREATE POLICY "Users can view own org logs_extraccion"
  ON public.logs_extraccion
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_active_org(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = logs_extraccion.tramite_id
        AND t.organization_id = public.get_active_org(auth.uid())
        AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
    )
  );

CREATE POLICY "Users can insert own org logs_extraccion"
  ON public.logs_extraccion
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_active_org(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tramites t
      WHERE t.id = logs_extraccion.tramite_id
        AND t.organization_id = public.get_active_org(auth.uid())
        AND (public.get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
    )
  );

CREATE POLICY "Users can update own org logs_extraccion"
  ON public.logs_extraccion
  FOR UPDATE
  TO authenticated
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

-- Revoke SQL DELETE privilege también, coherente con la ausencia de policy DELETE.
REVOKE DELETE ON public.logs_extraccion FROM authenticated;

COMMENT ON TABLE public.logs_extraccion IS
  'Logs de extracción OCR. Sin DELETE para usuarios: se preserva como evidencia. '
  'Pendiente de definir un uso accionable de estos datos (dashboard, alertas, '
  'revisión) — no implementar aún, requiere decisión de producto separada.';

COMMENT ON POLICY "Users can view own org logs_extraccion" ON public.logs_extraccion IS
  'Lectura restringida a miembros de la org activa; además admin/owner de la org o el creador del trámite asociado.';
COMMENT ON POLICY "Users can insert own org logs_extraccion" ON public.logs_extraccion IS
  'Inserción restringida a la org activa y al admin/owner o creador del trámite asociado.';
COMMENT ON POLICY "Users can update own org logs_extraccion" ON public.logs_extraccion IS
  'Actualización restringida a la org activa y al admin/owner o creador del trámite asociado.';

-- -----------------------------------------------------------------------------
-- 4) PERSONAS: eliminar policy DELETE redundante
-- -----------------------------------------------------------------------------
-- La policy "Users can manage personas" (FOR ALL) ya cubre DELETE con el mismo
-- predicado. La policy separada "Users can delete personas" es letra duplicada.
-- Como ambas son PERMISSIVE con el mismo USING, quitar la duplicada no cambia
-- el resultado efectivo (la ALL sigue autorizando DELETE con idéntico predicado).
DROP POLICY IF EXISTS "Users can delete personas" ON public.personas;

-- -----------------------------------------------------------------------------
-- 5) COMMENT ON POLICY para todas las políticas restantes de las 5 tablas
-- -----------------------------------------------------------------------------

-- Cancelaciones
COMMENT ON POLICY "Users view own org cancelaciones" ON public.cancelaciones IS
  'Lectura restringida a la org activa del usuario y verificando membresía real (defensa en profundidad).';
COMMENT ON POLICY "Users insert own org cancelaciones" ON public.cancelaciones IS
  'Inserción solo si organization_id = org activa y el usuario es miembro real de esa org.';
COMMENT ON POLICY "Users update own org cancelaciones" ON public.cancelaciones IS
  'Actualización solo si organization_id = org activa y el usuario es miembro real. No hay policy DELETE por decisión de retención legal.';

-- Personas
COMMENT ON POLICY "Users can manage personas" ON public.personas IS
  'Acceso completo (incluyendo DELETE) a personas cuyo trámite pertenece a la org activa, restringido a admin/owner o al creador del trámite.';

-- Organizations
COMMENT ON POLICY "Members can view their organizations" ON public.organizations IS
  'Solo miembros pueden leer la organización (via is_org_member).';
COMMENT ON POLICY "Owners can update org" ON public.organizations IS
  'Solo el owner de la org activa puede editar sus datos.';

-- Tramites
COMMENT ON POLICY "Users can view org tramites" ON public.tramites IS
  'Lectura restringida a la org activa; admin/owner ve todos, member solo los que creó.';
COMMENT ON POLICY "Users can insert org tramites" ON public.tramites IS
  'Creación de trámites solo dentro de la org activa del usuario.';
COMMENT ON POLICY "Users can update org tramites" ON public.tramites IS
  'Edición restringida a la org activa; admin/owner edita cualquiera, member solo los que creó.';
COMMENT ON POLICY "Users can delete own draft tramites" ON public.tramites IS
  'Solo borradores (status = pendiente) pueden borrarse, y solo por admin/owner de la org o el creador.';