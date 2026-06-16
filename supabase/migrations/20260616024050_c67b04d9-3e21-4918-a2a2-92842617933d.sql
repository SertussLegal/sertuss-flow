-- 1) Blindaje absoluto de profiles.role: ningún usuario autenticado puede mutarla.
--    Cambios de rol deben pasar EXCLUSIVAMENTE por public.memberships.
--    Funciones SECURITY DEFINER que sincronizan profiles.role (set_active_context,
--    handle_new_user, create_organization_for_user) ya corren sin auth.uid() del cliente
--    en escenarios server-side; cuando son llamadas por un usuario, el trigger las dejará
--    pasar siempre que el nuevo valor venga del state real de memberships (vía esas RPCs).
--    Para ser estrictos: bloqueamos cualquier cambio de role en UPDATE directo del cliente.

CREATE OR REPLACE FUNCTION public.prevent_profile_role_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- auth.uid() IS NULL = service_role / función definer interna → permitir.
    -- Cualquier sesión de usuario autenticado queda bloqueada sin excepciones.
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'profiles.role is read-only from client. Manage roles via public.memberships.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 2) system_events: revocar INSERT desde clientes autenticados.
--    Toda inserción debe provenir de service_role (edge functions) o funciones SECURITY DEFINER.
DROP POLICY IF EXISTS "Users can insert own org events" ON public.system_events;
