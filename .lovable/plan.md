# Diagnóstico — RLS de `cancelaciones`, `personas`, `organizations` (+ `tramites`, `logs_extraccion`)

> Informe de solo lectura. No modifica políticas ni migraciones. Cualquier cambio requiere confirmación explícita posterior.

## 1. Estado actual — políticas activas

### `cancelaciones` (3 políticas, sin DELETE)
```sql
-- SELECT
"Users view own org cancelaciones"  TO authenticated
USING (organization_id = get_active_org(auth.uid()) AND is_org_member(organization_id));

-- INSERT
"Users insert own org cancelaciones"  TO authenticated
WITH CHECK (organization_id = get_active_org(auth.uid()) AND is_org_member(organization_id));

-- UPDATE
"Users update own org cancelaciones"  TO authenticated
USING      (organization_id = get_active_org(auth.uid()) AND is_org_member(organization_id))
WITH CHECK (organization_id = get_active_org(auth.uid()) AND is_org_member(organization_id));

-- DELETE: (no existe policy)
```

### `personas` (2 políticas)
```sql
-- ALL (SELECT/INSERT/UPDATE)
"Users can manage personas"  TO authenticated
USING / WITH CHECK (EXISTS (
  SELECT 1 FROM tramites t
  WHERE t.id = personas.tramite_id
    AND t.organization_id = get_active_org(auth.uid())
    AND (get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid())
));

-- DELETE (duplica el mismo predicado, sólo para el verbo DELETE)
"Users can delete personas"  TO authenticated
USING (<mismo EXISTS de arriba>);
```

### `organizations` (3 políticas)
```sql
-- SELECT
"Members can view their organizations"  TO authenticated
USING (is_org_member(id));

-- INSERT
"Authenticated users can insert organizations"  TO authenticated
WITH CHECK (
  (credit_balance IS NULL OR credit_balance <= 5)
  AND (debug_tools_enabled IS NULL OR debug_tools_enabled = false)
);

-- UPDATE
"Owners can update org"  TO authenticated
USING (id = get_active_org(auth.uid()) AND get_user_role(auth.uid()) = 'owner');

-- DELETE: (no existe policy)
```

### `tramites` (4 políticas)
```sql
-- SELECT / INSERT / UPDATE: org + (owner|admin o created_by=self)
-- DELETE: sólo status='pendiente' + org + rol|creador
```

### `logs_extraccion` (1 policy ALL)
```sql
"Users can manage own org logs_extraccion"  TO authenticated
USING / WITH CHECK (
  organization_id = get_active_org(auth.uid())
  AND EXISTS (SELECT 1 FROM tramites t
              WHERE t.id = logs_extraccion.tramite_id
                AND t.organization_id = get_active_org(auth.uid())
                AND (get_user_role(auth.uid()) IN ('owner','admin') OR t.created_by = auth.uid()))
);
```

## 2. Historial de migraciones que tocan estas tablas

### `tramites` (4 migraciones)
- **20260305 (bootstrap)** — Crea tabla y las 3 políticas base SELECT/INSERT/UPDATE con aislamiento por `get_user_org` + rol.
- **20260310** — Añade DELETE sólo para borradores (`status='pendiente'`) del creador o admin. Problema resuelto: los usuarios necesitaban descartar trámites incompletos sin poder tocar los ya cerrados.
- **20260417** — No es RLS: añade trigger `assign_radicado_on_insert` (numeración secuencial). Se coló en la búsqueda porque referencia `public.tramites`.
- **20260617** — Barrido masivo: DROP+CREATE de casi todas las políticas del sistema con `search_path` cualificado (`public.tramites`, `public.get_active_org`) para blindar contra shadowing de schema y unificar el uso de `get_active_org`/`get_user_role`. No cambia semántica de acceso.

### `cancelaciones` (4 migraciones que tocan políticas — las otras 6 son ADD COLUMN/GRANT)
- **20260519** — Crea tabla + 3 políticas SELECT/INSERT/UPDATE usando `organization_id = get_active_org(auth.uid())`.
- **20260616 (25630)** — Endurece `profiles UPDATE` y storage `cancelaciones-plantillas`; no toca `cancelaciones` directamente (aparece por storage).
- **20260616 (30607)** — Refactor "doble predicado": DROP+CREATE de las 3 políticas de `cancelaciones` añadiendo `AND is_org_member(organization_id)`. Problema: defensa en profundidad — antes bastaba con `get_active_org` (que podía devolver algo si el active_context quedaba stale); ahora exige coincidencia real con membresía.
- **20260621 (170511)** — ADD COLUMN + `GRANT SELECT, INSERT, UPDATE, DELETE`. Ojo: concede el privilegio SQL DELETE, pero **no** crea una policy DELETE, así que sigue bloqueado por RLS.

### `personas` (3 migraciones)
- **20260305 (bootstrap)** — Crea policy ALL con EXISTS sobre `tramites` (aislamiento indirecto vía FK).
- **20260310** — Añade policy DELETE explícita duplicando el mismo predicado (para que el verbo DELETE funcione sin depender de la policy ALL, que en algunos motores no siempre cubre DELETE consistentemente).
- **20260617** — Barrido de blindaje `public.*` (mismo motivo que `tramites`).

### `organizations` — INSERT policy (relevante al punto 3)
- **20260307** — Se crea `"Authenticated users can insert organizations"` sin condición (WITH CHECK true).
- **20260705** — DROP+CREATE endureciendo el WITH CHECK: hoy exige `credit_balance ≤ 5` y `debug_tools_enabled = false/null`. Impide auto-provisionarse créditos o activar debug al crear la org, pero **no** limita a "sólo una org por usuario" ni valida el `name`/`nit` (eso se hace en el RPC `create_organization_for_user`).

## 3. Preguntas explícitas

**a) ¿El estado final es coherente o quedan restos viejos?**
Coherente. El barrido de junio (20260617) hizo DROP+CREATE de casi todas las políticas del sistema con nombres canónicos, así que no hay duplicados sombreados. Verificado en `pg_policies`: cada tabla tiene exactamente las políticas listadas arriba, sin nombres huérfanos como los de la versión pre-`get_active_org`. La única "duplicación aparente" es en `personas` (policy ALL + policy DELETE con el mismo predicado), pero es intencional y no crea hueco.

**b) `cancelaciones` sin policy DELETE — ¿existe otro mecanismo?**
Revisado: **no hay** RPC SECURITY DEFINER que borre cancelaciones, no hay soft-delete por columna (`deleted_at` no existe), y `service_role` sí puede borrar (bypass RLS) pero no se invoca desde ninguna edge function del proyecto. En la práctica **nadie borra un registro de `cancelaciones` jamás** desde el flujo actual. Esto es probablemente intencional (retención legal notarial), pero no está documentado en migración ni comentario de tabla. El `GRANT DELETE` de 20260621 es letra muerta: RLS lo bloquea silenciosamente.

**c) `organizations` INSERT — ¿qué impide abuso hoy?**
La policy sólo valida que `credit_balance ≤ 5` y `debug_tools_enabled ≠ true`. Un usuario autenticado llamando la Data API con `curl` **puede** crear filas arbitrarias en `organizations` con cualquier `name`, `nit`, `address`. Nada en la BD lo previene:
- No hay trigger de rate-limit.
- No hay validación de `name` no vacío en la tabla (el guard vive en el RPC `create_organization_for_user`, que la UI usa, pero el atacante puede saltarse el RPC).
- No hay unique constraint en `name` o `nit`.
- Sí queda huérfana: sin membership, `is_org_member(id)` devuelve false → el atacante ni siquiera puede leer la fila recién creada ni escalar a owner (memberships tiene su propia policy de anti-self-insert, migración 20260523).
- Impacto real: **basura en la tabla** (spam de filas huérfanas + posible enumeración/DoS de espacio), pero **no** privilege escalation.

**d) `logs_extraccion` DELETE — ¿limita a "propios" o cualquier miembro puede borrar?**
La policy es org-scoped, **no** user-scoped. Semántica exacta: cualquier usuario **de la organización** puede borrar logs de extracción de trámites de esa org, siempre que sea (owner|admin) O (creador del trámite). Es decir:
- Un `member` regular sólo puede borrar logs de trámites que él mismo creó.
- Un `owner`/`admin` puede borrar logs de cualquier trámite de su org, incluidos los creados por otros miembros.

Esto es consistente con el modelo de `tramites`/`personas`. No hay hueco cross-org, pero sí hay riesgo intra-org: un admin puede borrar evidencia de auditoría OCR de un trámite que él no creó. Si `logs_extraccion` tiene valor forense/legal, esto debería revisarse.

## 4. Datos sensibles por tabla y aislamiento por tenant

| Tabla | Columnas sensibles | Aislamiento efectivo |
|---|---|---|
| `cancelaciones` | `data_final` (JSONB con cédulas, NIT, dirección inmueble, valor crédito, apoderado banco), `data_ia`, `texto_final_word` | ✅ Doble predicado: `organization_id = get_active_org` **y** `is_org_member(organization_id)`. Sin fugas cross-tenant. |
| `personas` | `numero_documento` (cédula), `nombres`, `apellidos`, `email`, `telefono`, `direccion` | ✅ Indirecto vía FK `tramites.organization_id = get_active_org` + rol/creador. Sin fugas cross-tenant. |
| `organizations` | `credit_balance`, `nit`, `address`, `debug_tools_enabled` | ✅ SELECT gateado por `is_org_member(id)`. INSERT abierto (ver punto 3c). UPDATE sólo `owner` del active_context. |
| `tramites` | `data_extracted` (JSONB con todo OCR), `data_final`, `texto_final_word` | ✅ Doble check: org + (rol admin/owner o creador). |
| `logs_extraccion` | `raw_response` (JSONB con datos OCR crudos: cédulas, direcciones, valores) | ⚠️ Aislado por org pero DELETE amplio para admins (ver 3d). |

**Todos usan `organization_id`** — no hay policy que se aísle sólo por `user_id` sin filtro de org, así que el multi-tenant es sólido a nivel horizontal.

## 5. Recomendaciones (NO implementar sin confirmación)

1. **`cancelaciones` — decisión explícita sobre DELETE**
   - Opción A (retención legal): añadir `REVOKE DELETE ON public.cancelaciones FROM authenticated;` + `COMMENT ON TABLE ... IS 'Registro notarial: retención legal, sin borrado'`. Documenta el vacío intencional.
   - Opción B (borrado de borradores): añadir policy `DELETE` análoga a `tramites` (sólo si `status = 'borrador'` y creador/admin de la org).

2. **`organizations` INSERT — cerrar el abuso vía API directa**
   - Cambiar la policy a `WITH CHECK (false)` y forzar toda creación por el RPC `create_organization_for_user` (SECURITY DEFINER, ya con guards de nombre y NIT). El RPC seguirá funcionando; la UI ya lo usa; los ataques directos a la Data API dejan de crear filas huérfanas.
   - Alternativa suave: mantener INSERT abierto pero añadir NOT NULL + CHECK de longitud en `name` a nivel columna, y un `AFTER INSERT` trigger que exija que el creador tenga (o abra en el mismo momento) una membership.

3. **`logs_extraccion` — proteger evidencia forense**
   - Si estos logs son parte del pipeline de auditoría legal (activity_logs ya es append-only), aplicar el mismo patrón: dividir la policy ALL en SELECT/INSERT/UPDATE y añadir explícitamente `Deny delete for authenticated`. Sólo service_role borra (para purge_expired_drafts).

4. **`personas` — simplificar (cosmético)**
   - La policy ALL ya cubre DELETE en Postgres moderno. La policy DELETE separada es redundante desde la migración 20260617 (mismo predicado). No es un bug, pero limpiarlo reduce ruido.

5. **Documentar** en `COMMENT ON POLICY ...` la intención de cada regla — hoy el "por qué" vive sólo en los archivos de migración.

**Restricción:** este documento no ejecuta ninguno de estos ajustes. Esperando tu confirmación explícita para pasar a una sesión de implementación con migración concreta.
