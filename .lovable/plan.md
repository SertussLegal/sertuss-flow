# Plan: Endurecimiento defense-in-depth (Fase de seguridad)

Migración **única** de solo policies. **No** modifica tablas, funciones, ni comportamiento de la app. SQL abajo listo para revisión línea por línea.

---

## 1. Contexto y patrón a replicar

Patrón canónico ya en producción (tabla `cancelaciones`):

```sql
USING ((organization_id = get_active_org(auth.uid())) AND is_org_member(organization_id))
```

`is_org_member(uuid)` (SECURITY DEFINER, ya existe) valida que `auth.uid()` esté en `memberships` para esa org, sin depender de `user_active_context`. Añadirlo en AND es una segunda barrera: aunque un atacante lograra manipular `user_active_context` para apuntar a otra org, seguiría fallando el `is_org_member`.

Tablas hijas (`logs_extraccion`, `historial_validaciones`) no necesitan añadir nada: ya validan vía `EXISTS(tramites t WHERE t.organization_id = get_active_org(...))`. La refuerzo blindando **`tramites`** (padre), lo que propaga la garantía.

Tablas a endurecer directamente: `tramites`, `configuracion_notaria`, `notaria_styles`.
Tablas hijas: se blindan indirectamente al endurecer `tramites`, pero además añadimos `is_org_member` a `logs_extraccion` e `historial_validaciones` para hacerlo explícito.

---

## 2. SQL exacto (una sola migración)

```sql
-- =========================================================
-- BLOQUE 1 · tramites (SELECT / UPDATE / DELETE / INSERT)
-- =========================================================
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

-- =========================================================
-- BLOQUE 2 · configuracion_notaria (SELECT + ALL)
-- =========================================================
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

-- =========================================================
-- BLOQUE 3 · notaria_styles (SELECT + ALL)
-- =========================================================
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

-- =========================================================
-- BLOQUE 4 · logs_extraccion (SELECT / UPDATE / INSERT)
-- Refuerzo explícito de is_org_member. El EXISTS(tramites) ya
-- garantiza el aislamiento; esto silencia el scanner y añade
-- una segunda barrera coherente.
-- =========================================================
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

-- =========================================================
-- BLOQUE 5 · historial_validaciones (SELECT)
-- =========================================================
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
-- (la policy INSERT existente es para service_role: NO se toca)

-- =========================================================
-- BLOQUE 6 · credit_consumption (INSERT hardening + explicit deny)
-- =========================================================

-- 6a. INSERT: hoy la policy ya está restringida a role service_role
-- (los únicos inserts vienen de consume_credit_v2 / unlock_expediente,
-- que son SECURITY DEFINER — corren como owner y saltan RLS de todos
-- modos, así que este WITH CHECK sólo aplica a llamadas directas con
-- la service_role key). Aun así endurecemos el WITH CHECK de `true`
-- a validaciones de integridad mínimas para silenciar el scanner sin
-- romper nada (ningún caller inserta filas con estos campos nulos).
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

-- 6b. UPDATE / DELETE: explicit deny (defense-in-depth cosmético).
-- Sin estas policies el comportamiento ya era deny-by-default; sólo
-- las añadimos para que el scanner no las marque como "sin restricción".
CREATE POLICY "No updates on credit_consumption"
ON public.credit_consumption FOR UPDATE TO authenticated
USING (false) WITH CHECK (false);

CREATE POLICY "No deletes on credit_consumption"
ON public.credit_consumption FOR DELETE TO authenticated
USING (false);
```

---

## 3. Análisis de impacto — por qué NO rompe nada probado hoy

| Cambio | Flujo afectado | Confirmación |
|---|---|---|
| `tramites` + `is_org_member` | Dashboard, Cancelaciones, Validación, edición de trámites | Todo usuario legítimo con sesión activa siempre tiene `memberships(user_id, active_org_id)` (garantizado por `handle_new_user`, `accept_invitation`, `set_active_context`). `is_org_member` retorna `true` para él → policy pasa igual que antes. |
| `configuracion_notaria` + `is_org_member` | `NotariaSettings.tsx` (admin), `configuracion_notaria` en generación | Idem: el usuario que ve/edita config siempre es miembro de su active_org. |
| `notaria_styles` + `is_org_member` | Preview docx (lee estilos), NotariaSettings | Idem. |
| `logs_extraccion` + `is_org_member` | Auditoría OCR en Validación, `descubrir-reglas` (corre con service_role → bypass RLS) | Frontend: el usuario ve logs de sus propios trámites en su org → sigue miembro → pasa. Edge fn: service_role bypass. |
| `historial_validaciones` + `is_org_member` | Solo lectura desde UI | Idem. |
| `credit_consumption` INSERT hardening | `consume_credit_v2`, `unlock_expediente` | Ambos son SECURITY DEFINER → corren como owner → **bypass RLS total** → el WITH CHECK ni se evalúa. Cualquier caller vía service_role key ya envía `organization_id`, `user_id`, `action`, `credits` no nulos (revisado en `_shared` de edge fns). |
| `credit_consumption` UPDATE/DELETE deny | Nadie updatea/borra hoy | `credit_consumption` es append-only por diseño. Deny explícito == comportamiento actual. |

**No hay caso legítimo hoy** donde `authenticated` inserte en `credit_consumption` directamente (solo lee via `Team.tsx` / admin). Confirmado revisando `src/services/credits.ts` (llama RPC) y grep del proyecto.

---

## 4. Plan de verificación

### 4.1 Tests locales (bunx)
```
bunx vitest run
```
Esperar 96/96 verde (no cambia lógica de app, solo RLS).

### 4.2 Linter Supabase
```
supabase--linter
```
Esperar: warnings de `credit_consumption` UPDATE/DELETE desaparecen. Los 55 warnings de `SECURITY DEFINER function executable` siguen (fuera de scope de esta migración).

### 4.3 Prueba cross-org real (misma de auditoría anterior)
- Playwright con JWT real de usuario A (org A) → GET a `/rest/v1/tramites?organization_id=eq.<orgB_id>` → esperar `[]`.
- Repetir para `configuracion_notaria`, `notaria_styles`, `logs_extraccion`, `historial_validaciones`.

### 4.4 Prueba de no-regresión (usuario legítimo)
- Mismo Playwright usuario A: `GET /rest/v1/tramites?select=id,tipo,status&limit=5` → esperar filas de su org visibles.
- Navegar UI: Dashboard (lista trámites), abrir un trámite (config_notaria + logs_extraccion cargan), NotariaSettings (styles cargan/editan).
- Screenshot de cada paso.

### 4.5 Prueba edge functions
- Invocar `process-expediente` sobre un trámite del usuario A → esperar éxito (SECURITY DEFINER + service_role no afectados).
- Invocar `descubrir-reglas` desde Admin → esperar éxito y nuevas propuestas.
- Consumir un crédito real (unlock_expediente) → verificar fila nueva en `credit_consumption`.

---

## 5. Riesgos conocidos y mitigación

- **Riesgo:** un usuario en tránsito de `switchContext` (medio segundo entre `set_active_context` y refetch de UI) podría fallar policies si `user_active_context` aún no cuadra. **Mitigación:** ya era así antes (policy vieja también dependía de `get_active_org`); `is_org_member` no lo empeora.
- **Rollback:** si algo se rompe, un DROP+CREATE inverso restaura las policies originales. Guardaré el SQL de rollback en el mismo archivo de migración como comentario al pie.

---

## 6. Restricción respetada

**Este plan NO ejecuta nada.** Espero tu aprobación línea por línea antes de crear la migración vía `supabase--migration`.
