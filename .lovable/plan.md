# Plan: cerrar 55 warnings SECURITY DEFINER + smoke-test tablas vacías

Solo diseño. Nada se ejecuta. Revisa el SQL línea por línea antes de aprobar.

## Contexto

El linter marca cada función `SECURITY DEFINER` en `public` como warning porque, por default, `PUBLIC` (que incluye `anon` y `authenticated`) tiene `EXECUTE`. Endurecemos por función según quién la llama hoy realmente (verificado vía grep en `src/` + `supabase/functions/`).

## Inventario de callers (verificado hoy)

| Función | Caller real hoy | Rol requerido |
|---|---|---|
| `consume_credit_v2` | `src/services/credits.ts`, edge `procesar-cancelacion` (con userClient) | authenticated |
| `unlock_expediente` | `src/pages/Validacion.tsx` | authenticated |
| `set_active_context` | `src/contexts/AuthContext.tsx` | authenticated |
| `create_organization_for_user` | `AuthContext.tsx`, `SetupOrgModal.tsx` | authenticated |
| `is_platform_admin` | `descubrir-reglas` (userClient) + usada en policies | authenticated |
| `admin_review_propuesta` | `PropuestaDetalleModal.tsx` | authenticated (chequea `is_platform_admin` dentro) |
| `admin_list_org_users`, `admin_update_organization`, `admin_toggle_module` | `AdminOrgEdit.tsx` | authenticated (chequea admin dentro) |
| `get_all_organizations`, `admin_update_credits`, `admin_set_debug_tools` | `Admin.tsx` | authenticated (chequea admin dentro) |
| `restore_credit` | edge `procesar-cancelacion` (serviceClient) | service_role SOLO — bloquea `auth.uid() IS NOT NULL` |
| `consume_credit` (legacy wrapper) | nadie en frontend/edge | revocable de todos |
| `get_active_org`, `get_user_org`, `get_user_role`, `is_org_member`, `is_org_admin` | usadas dentro de policies RLS | authenticated (RLS evalúa con el rol del caller) |
| `accept_invitation` | nadie hoy en el código, pero es user-facing por diseño | authenticated |
| `next_radicado` | trigger `assign_radicado_on_insert` | interna |
| `purge_expired_drafts` | nadie (job manual/cron a futuro) | service_role |
| Triggers puros (`assign_radicado_on_insert`, `handle_new_user`, `assign_core_modules_on_org_insert`, `prevent_profile_role_self_update`, `handle_membership_revocation`, `set_logs_extraccion_org`, `set_updated_at`, `enforce_credit_tramite`, `log_word_generated`, `validate_configuracion_notaria`, `validate_reglas_validacion`, `validate_historial_validaciones`) | disparadas por triggers, nadie las llama directo | ninguna directa |

## Tarea 1 — SQL de REVOKE/GRANT (diseño, no ejecutar)

Estrategia: para toda función, primero `REVOKE EXECUTE ... FROM PUBLIC` (borra el default) y luego `GRANT EXECUTE ... TO <roles>` explícito. Es idempotente y quirúrgico.

```sql
-- =========================================================
-- BLOQUE A: funciones para authenticated (usuario logueado)
-- =========================================================
-- Callable desde el cliente autenticado o desde policies RLS.

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
-- restore_credit ya bloquea auth.uid() IS NOT NULL, pero además revocamos EXECUTE.
-- purge_expired_drafts: mantenimiento, sin caller autenticado.
-- consume_credit (wrapper legacy): sin callers.

REVOKE EXECUTE ON FUNCTION public.restore_credit(uuid)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.restore_credit(uuid)           TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_expired_drafts()         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_expired_drafts()         TO service_role;

REVOKE EXECUTE ON FUNCTION public.consume_credit(uuid)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_credit(uuid)           TO service_role;

REVOKE EXECUTE ON FUNCTION public.next_radicado(uuid)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.next_radicado(uuid)            TO service_role;

-- =========================================================
-- BLOQUE C: funciones de trigger puras (ningún caller directo)
-- =========================================================
-- El motor de triggers ejecuta como owner; nadie necesita EXECUTE.

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
```

### Recomendación sobre `admin_*` (Bloque A)

Se mantienen accesibles a `authenticated` porque el frontend las invoca con JWT normal — el gate lo hace `is_platform_admin()` dentro de cada función y devuelve `Unauthorized` para cualquier otro usuario. Revocar de `authenticated` rompería `AdminOrgEdit.tsx`, `Admin.tsx` y `PropuestaDetalleModal.tsx`. No hay ganancia real de seguridad porque el check interno ya es estricto y auditado.

### Notas

- `tramite_org_from_path` la incluí en Bloque A porque puede usarse desde RLS de storage; si no la usa nadie hoy la movemos a Bloque C. Verificable con `\df+`.
- No tocamos `has_role` porque no aparece listada en las funciones actuales del proyecto (está mencionada en la doc pero no existe en el DDL cargado).

## Tarea 2 — Smoke-test controlado de tablas vacías

Objetivo: cerrar el hueco empírico del audit adversarial (`configuracion_notaria` y `notaria_styles` sin filas) confirmando que un usuario legítimo SÍ ve sus propias filas y NO ve las ajenas, con las policies endurecidas ya en vigor.

Script pensado para correr contra el preview con el JWT real del usuario dueño de la sesión (no service_role). Se ejecuta con Playwright desde `/tmp/browser/rls_smoke/` inyectando la sesión Supabase ya minted por Lovable (patrón estándar `LOVABLE_BROWSER_SUPABASE_*`).

```python
# /tmp/browser/rls_smoke/run.py — SOLO DISEÑO, NO EJECUTAR AÚN
# Pasos:
# 1. Restaurar sesión Supabase del usuario legítimo (patrón LOVABLE_BROWSER_*).
# 2. Leer active_org vía RPC get_active_org(auth.uid()).
# 3. INSERT una fila de prueba en configuracion_notaria con
#    organization_id = active_org, notario = 'SMOKE-TEST', etc.
# 4. SELECT * FROM configuracion_notaria WHERE organization_id = active_org
#    → debe devolver la fila insertada.
# 5. SELECT * FROM configuracion_notaria WHERE organization_id = '<uuid-ajeno-conocido>'
#    → debe devolver [].
# 6. Repetir 3-5 para notaria_styles (nombre_estilo = 'SMOKE-TEST').
# 7. DELETE WHERE notario = 'SMOKE-TEST' y DELETE WHERE nombre_estilo = 'SMOKE-TEST'.
# 8. Assert final: SELECT count(*) WHERE notario='SMOKE-TEST' = 0.
```

Todas las operaciones vía el cliente `supabase-js` de la app (no `psql`, no service_role) para ejercitar RLS real. El `active_org` y el uuid ajeno se leen del entorno actual, no se hardcodean.

## Tarea 3 — Impacto sobre flujos ya verificados

| Flujo | Función tocada | Impacto |
|---|---|---|
| Consumo créditos (validación, apertura expediente, docx) | `consume_credit_v2`, `unlock_expediente` | Ninguno: authenticated sigue con EXECUTE |
| Cancelaciones (edge `procesar-cancelacion`) | `consume_credit_v2` (user JWT), `restore_credit` (service_role) | Ninguno: cada rol conserva el privilegio que usa |
| Escrituras (edge `process-expediente`) | usa service_role para todo | Ninguno |
| `descubrir-reglas` (edge) | `is_platform_admin` con userClient | Ninguno: authenticated conserva EXECUTE |
| Panel admin (`Admin.tsx`, `AdminOrgEdit.tsx`, `PropuestaDetalleModal.tsx`) | `admin_*`, `get_all_organizations`, `admin_review_propuesta` | Ninguno: authenticated conserva EXECUTE, gate interno intacto |
| Auth/onboarding | `create_organization_for_user`, `set_active_context`, `handle_new_user` (trigger) | Ninguno: RPC accesibles, trigger sin cambio de invocación |
| Policies RLS | `get_active_org`, `is_org_member`, etc. | Ninguno: authenticated retiene EXECUTE, requerido por el evaluador RLS |

## Verificación post-migración (cuando apruebes)

1. `SELECT proname, proacl FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef` — confirmar ACLs finales.
2. Re-correr el linter Supabase: los 55 warnings deben bajar a ~0 en esta categoría.
3. `bunx vitest run` completo.
4. Smoke-test de Tarea 2.
5. Repetir el cross-org RLS Playwright del audit anterior (debe seguir bloqueando lecturas ajenas).
6. Prueba manual mínima en el preview: login, crear trámite, abrir expediente (consume créditos), abrir panel admin como `info@sertuss.com`, aprobar/rechazar una propuesta en `admin_review_propuesta`.

## Riesgos residuales conocidos

- Si algún caller autenticado de `next_radicado` existiera fuera del trigger (no encontrado hoy), fallaría. Rollback: `GRANT EXECUTE ... TO authenticated`.
- `accept_invitation` no tiene UI hoy; cuando se agregue debe llamarse con JWT autenticado (ya cubierto).
- `tramite_org_from_path` — si el linter la marca como no usada tras la migración, la degradamos a service_role en un follow-up.

Nada se ejecuta hasta tu OK explícito.
