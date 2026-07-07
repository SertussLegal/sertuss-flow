-- =========================================================
-- BLOQUE A: funciones para authenticated (usuario logueado)
-- =========================================================
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'consume_credit_v2(uuid,uuid,text,uuid,text,integer)',
    'unlock_expediente(uuid,uuid,uuid)',
    'set_active_context(uuid)',
    'create_organization_for_user(uuid,text,text)',
    'accept_invitation(uuid)',
    'is_platform_admin()',
    'get_active_org(uuid)',
    'get_user_org(uuid)',
    'get_user_role(uuid)',
    'is_org_member(uuid)',
    'is_org_admin(uuid)',
    'admin_review_propuesta(uuid,text,jsonb,text)',
    'admin_list_org_users(uuid)',
    'admin_update_organization(uuid,text,varchar,text)',
    'admin_toggle_module(uuid,text,boolean)',
    'get_all_organizations()',
    'admin_update_credits(uuid,integer,text)',
    'admin_set_debug_tools(uuid,boolean)',
    'tramite_org_from_path(text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- =========================================================
-- BLOQUE B: solo service_role
-- =========================================================
REVOKE EXECUTE ON FUNCTION public.restore_credit(uuid)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_credit(uuid)           TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_expired_drafts()         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_expired_drafts()         TO service_role;

REVOKE EXECUTE ON FUNCTION public.consume_credit(uuid)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_credit(uuid)           TO service_role;

REVOKE EXECUTE ON FUNCTION public.next_radicado(uuid)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.next_radicado(uuid)            TO service_role;

-- =========================================================
-- BLOQUE C: funciones de trigger puras
-- =========================================================
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'assign_radicado_on_insert()',
    'handle_new_user()',
    'assign_core_modules_on_org_insert()',
    'prevent_profile_role_self_update()',
    'handle_membership_revocation()',
    'set_logs_extraccion_org()',
    'set_updated_at()',
    'enforce_credit_tramite()',
    'log_word_generated()',
    'validate_configuracion_notaria()',
    'validate_reglas_validacion()',
    'validate_historial_validaciones()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;
