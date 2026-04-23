

## Aplicar migración SQL: memberships + auditoría de créditos

Voy a ejecutar la migración en Lovable Cloud (modo Build) que crea toda la infraestructura de multi-pertenencia y trazabilidad atómica de créditos.

### Qué hace la migración

**1. Tablas nuevas**

- `memberships(id, user_id, organization_id, role, is_personal, created_at)` con `unique(user_id, organization_id)`. Reemplaza el `profiles.organization_id` único.
- `user_active_context(user_id pk, organization_id, updated_at)`. Guarda qué contexto está usando cada usuario ahora mismo.
- `credit_consumption(id, organization_id, user_id, tramite_id, action, credits, tipo_acto, created_at)` con índices `(organization_id, created_at)` y `(user_id, created_at)`. Tabla de auditoría inmutable.

**2. Funciones**

- `get_active_org(uid)` → lee `user_active_context`; fallback a la membresía personal del usuario. Reemplaza el rol de `get_user_org` sin romperlo (lo mantenemos como wrapper que ahora delega en `get_active_org`).
- `get_user_role(uid)` → ahora devuelve el rol de la membresía activa.
- `set_active_context(p_org_id)` → valida que el usuario tenga membresía en esa org y actualiza `user_active_context`. También sincroniza `profiles.organization_id` y `profiles.role` por compatibilidad.
- `consume_credit_v2(p_org_id, p_user_id, p_action, p_tramite_id, p_tipo_acto)` → **atómica**: `SELECT ... FOR UPDATE` del balance, `UPDATE organizations`, `INSERT credit_consumption`, todo en una transacción. Falla → rollback completo, no queda gasto sin auditoría.
- `unlock_expediente(...)` → reescrita con la misma garantía atómica (descuenta 2, inserta una fila `APERTURA_EXPEDIENTE`).
- `consume_credit(org_id)` legacy → wrapper que delega en `consume_credit_v2` con `auth.uid()` y `action='LEGACY'`.
- `handle_new_user()` → guarda `full_name` desde `raw_user_meta_data`, crea organización personal con 5 créditos, inserta `memberships(is_personal=true, role='owner')` y `user_active_context`.
- `accept_invitation(p_invitation_id)` → al aceptar, crea membresía no-personal y marca `accepted_at`. No toca la org personal del invitado.

**3. RLS**

- `memberships`: usuario ve sus propias membresías; owner/admin de una org ven todas las membresías de esa org.
- `user_active_context`: cada usuario solo ve y actualiza la suya.
- `credit_consumption`:
  - SELECT: `(organization_id = get_active_org(auth.uid()) AND get_user_role(auth.uid()) IN ('owner','admin'))` **OR** `user_id = auth.uid()`. Cumple la regla: un member solo ve lo suyo; owner/admin ven el global de la org activa. Si el usuario cambia de contexto a una org donde es 'member', deja de ver el historial global de la otra.
  - INSERT: solo `service_role` (las funciones SECURITY DEFINER).
- Todas las políticas existentes (`tramites`, `personas`, `inmuebles`, `actos`, `configuracion_notaria`, `notaria_styles`, `historial_validaciones`, `invitations`, `activity_logs`, `organizations`) se mantienen llamando a `get_user_org` — que ahora internamente delega en `get_active_org`. Cambio transparente, cero riesgo de romper acceso.

**4. Backfill (datos existentes)**

- Para cada `profiles` con `organization_id` actual: `INSERT INTO memberships` con su rol; `is_personal = true` solo si el usuario es el único owner y la org tiene un único miembro (heurística conservadora).
- `INSERT INTO user_active_context` apuntando a esa org.
- Sin pérdida de datos: nada se borra ni se reasigna.

### Garantías clave

- **Atomicidad**: `consume_credit_v2` y `unlock_expediente` ejecutan deducción + auditoría en una sola transacción. Imposible gasto sin registro.
- **Aislamiento por contexto**: `get_active_org` se evalúa en cada query; cambiar de perfil cambia inmediatamente qué trámites, créditos y consumo se ven.
- **Compatibilidad hacia atrás**: `get_user_org`, `consume_credit(org_id)` y `profiles.organization_id` siguen funcionando — el código actual no se rompe mientras se hace el rollout del frontend.

### Después de la migración

Una vez aplicada, sigue la implementación frontend ya planificada:
1. `Login.tsx` — campo "Nombre completo" obligatorio.
2. `AuthContext.tsx` — cargar `memberships`, exponer `activeMembership` y `switchContext()`.
3. `ProfileSwitcher.tsx` (nuevo) — dropdown en header.
4. `Team.tsx` — pestaña "Consumo" con filtro por miembro y mes + edición inline de nombre.
5. `Validacion.tsx` — migrar llamadas a `consume_credit_v2` pasando `user_id`, `action`, `tramite_id`, `tipo_acto`.

### Riesgo y mitigación

- Si una RLS quedara mal evaluada tras el cambio, `get_active_org` siempre tiene fallback a la org personal del usuario → nadie queda sin acceso.
- Migración idempotente: usa `IF NOT EXISTS` en tablas y `CREATE OR REPLACE` en funciones.

