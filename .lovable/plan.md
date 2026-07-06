# Auditoría post-migración de `credit_prices` + funciones de créditos

Solo lectura y simulación. Cero cargos reales generados. Los edge cases se probaron con `SELECT` sobre `credit_prices` real y con `VALUES` sintéticos (sin tocar datos).

---

## 1. Estado real post-migración

### 1a. Contenido actual de `credit_prices` (3 filas activas)

| action | tipo_acto | credits | active | notes |
|---|---|---|---|---|
| APERTURA_EXPEDIENTE | compraventa_hipoteca | **3** | true | Apertura de expediente de escritura compraventa+hipoteca |
| GENERACION_DOCX | cancelacion_hipoteca | **2** | true | Generación de cancelación de hipoteca |
| OCR_DOCUMENTO | * | **1** | true | OCR unitario por documento |

### 1b. Constraints activos
- `PRIMARY KEY (id)`
- `UNIQUE (action, tipo_acto)` — nombre `credit_prices_action_tipo_unique`
- `CHECK (credits >= 0 AND credits <= 100)` — nombre `credit_prices_credits_check`
- `FOREIGN KEY (updated_by) REFERENCES auth.users(id)`

### 1c. Políticas RLS (RLS enabled = true)

| polname | cmd | roles | USING | WITH CHECK |
|---|---|---|---|---|
| credit_prices readable by authenticated | SELECT (`r`) | authenticated | `true` | — |
| credit_prices writable by platform admin | ALL (`*`) | authenticated | `is_platform_admin()` | `is_platform_admin()` |

### 1d. `consume_credit_v2` (real, post-migración)

```sql
CREATE OR REPLACE FUNCTION public.consume_credit_v2(
  p_org_id uuid, p_user_id uuid, p_action text,
  p_tramite_id uuid DEFAULT NULL, p_tipo_acto text DEFAULT NULL, p_credits integer DEFAULT 1
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE current_balance integer; v_resolved integer; v_final integer;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Unauthorized: user mismatch'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = p_org_id)
    THEN RAISE EXCEPTION 'Unauthorized: not a member of organization'; END IF;

  SELECT credits INTO v_resolved
  FROM public.credit_prices
  WHERE active = true AND action = p_action
    AND (tipo_acto = p_tipo_acto OR tipo_acto = '*')
  ORDER BY (tipo_acto = COALESCE(p_tipo_acto, '')) DESC LIMIT 1;

  v_final := COALESCE(v_resolved, p_credits, 1);

  SELECT credit_balance INTO current_balance FROM organizations WHERE id = p_org_id FOR UPDATE;
  IF current_balance IS NULL OR current_balance < v_final THEN RETURN false; END IF;

  UPDATE organizations SET credit_balance = credit_balance - v_final WHERE id = p_org_id;
  INSERT INTO credit_consumption (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, p_action, v_final, p_tipo_acto);
  RETURN true;
END; $$;
```

### 1e. `unlock_expediente` (real, post-migración)

```sql
CREATE OR REPLACE FUNCTION public.unlock_expediente(p_org_id uuid, p_tramite_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE current_balance integer; v_tipo_acto text; v_price integer;
BEGIN
  -- (3 guardas idénticas al diseño: user mismatch, membership, tramite pertenece a org)
  SELECT tipo INTO v_tipo_acto FROM tramites WHERE id = p_tramite_id;
  SELECT credits INTO v_price FROM credit_prices
   WHERE active = true AND action = 'APERTURA_EXPEDIENTE'
     AND (tipo_acto = v_tipo_acto OR tipo_acto = '*')
   ORDER BY (tipo_acto = COALESCE(v_tipo_acto,'')) DESC LIMIT 1;
  v_price := COALESCE(v_price, 2);

  SELECT credit_balance INTO current_balance FROM organizations WHERE id = p_org_id FOR UPDATE;
  IF current_balance IS NULL OR current_balance < v_price THEN RETURN false; END IF;

  UPDATE organizations SET credit_balance = credit_balance - v_price WHERE id = p_org_id;
  UPDATE tramites SET is_unlocked = true WHERE id = p_tramite_id;

  INSERT INTO credit_consumption (organization_id, user_id, tramite_id, action, credits, tipo_acto)
  VALUES (p_org_id, p_user_id, p_tramite_id, 'APERTURA_EXPEDIENTE', v_price, v_tipo_acto);
  INSERT INTO activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (p_org_id, p_user_id, 'APERTURA_EXPEDIENTE', 'tramite', p_tramite_id,
    jsonb_build_object('credits_consumed', v_price, 'old_balance', current_balance, 'new_balance', current_balance - v_price));
  RETURN true;
END; $$;
```

**Coincidencia con el diseño aprobado: total.** Cero desviaciones.

---

## 2. Edge cases probados

### EC1 — `p_tipo_acto` NULL y sin fila `tipo_acto = '*'` para esa acción
Simulación con `action='ACCION_INEXISTENTE'` sobre la tabla real: retorna **0 filas**. → `v_resolved` queda NULL → `v_final := COALESCE(NULL, p_credits, 1)`.
**Resultado: usa el `p_credits` que envió el cliente.** Comportamiento esperado (fallback defensivo).
⚠️ **Sutileza**: `(tipo_acto = NULL)` en el WHERE nunca es true en SQL (siempre desconocido). Solo la rama `tipo_acto = '*'` puede matchear cuando `p_tipo_acto` es NULL. Correcto según diseño.

### EC2 — Fila exacta + comodín simultáneas para la misma acción
Simulé con `(APERTURA_EXPEDIENTE, compraventa_hipoteca, 3)` y `(APERTURA_EXPEDIENTE, *, 5)`, llamando con `p_tipo_acto='compraventa_hipoteca'`:
**Resultado: gana la exacta (credits=3).** El `ORDER BY (tipo_acto = COALESCE(p_tipo_acto,'')) DESC` resuelve determinísticamente:
- exacta → `('compraventa_hipoteca' = 'compraventa_hipoteca')` = true = 1
- comodín → `('*' = 'compraventa_hipoteca')` = false = 0
No hay ambigüedad. ✅

### EC3 — Fila exacta `active=false` + comodín `active=true`
Simulé y devuelve el comodín (credits=9). ✅
🚨 **Cabo suelto detectado**: si un admin más tarde intenta reactivar la fila exacta con `INSERT` (creyendo que fue "borrada"), **fallará con UNIQUE violation** porque el `UNIQUE(action, tipo_acto)` **no distingue por `active`**. La operación correcta es `UPDATE ... SET active = true`. No es un bug de runtime, es un footgun operacional para quien administre la tabla.

### EC4 — Verificar que `credits` registrado ignora al cliente si hay fila
**No se ejecutó llamada real** (requeriría un usuario autenticado con `auth.uid()`, membership, y consumiría saldo). La lectura del código confirma el invariante:
- Línea `v_final := COALESCE(v_resolved, p_credits, 1);`
- `INSERT INTO credit_consumption (..., credits, ...) VALUES (..., v_final, ...);`
Si el cliente enviara `p_credits: 999` para `action='OCR_DOCUMENTO'`, `v_resolved=1` (de la tabla) → `v_final=1` → se cobra y se registra **1**. **El invariante se sostiene por construcción del código.** Si quieres una prueba empírica real, requiere un usuario de prueba y consumo real de 1 crédito (recomendado hacerlo en una sesión de build mode explícita).

### EC5 — `p_tipo_acto` NULL cuando SÍ existe fila con `tipo_acto = '*'`
Ejemplo real: `consume_credit_v2(..., p_action='OCR_DOCUMENTO', p_tipo_acto=NULL)`.
- WHERE deja pasar solo la fila `('OCR_DOCUMENTO', '*')` → `v_resolved=1`.
- ORDER BY: `('*' = COALESCE(NULL,''))` = `('*' = '')` = false. Da igual, hay una sola fila. ✅

### EC6 (no pedido pero relevante) — Colisión wildcard vs exacta cuando **cliente pasa `p_tipo_acto = '*'` literal**
`WHERE tipo_acto = '*' OR tipo_acto = '*'` seguido de `ORDER BY (tipo_acto = '*') DESC`. Ambas condiciones son iguales, matchea solo la wildcard real. No es un vector de manipulación explotable.

---

## 3. RLS de `credit_prices`

**SELECT**: policy `credit_prices readable by authenticated` con `USING true` sobre rol `authenticated` → cualquier usuario logueado lee las 3 filas.

**INSERT/UPDATE/DELETE**: **única policy** `credit_prices writable by platform admin` con `polcmd = '*'` (aplica a INSERT+UPDATE+DELETE+SELECT) y filtro `is_platform_admin()`. La función `is_platform_admin()` está definida en la base:
```sql
SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND lower(email) = 'info@sertuss.com');
```
→ Un usuario normal falla la evaluación tanto en `USING` como en `WITH CHECK`. RLS bloquea correctamente.

⚠️ **Nota menor**: la policy `ALL` **también aplica a SELECT** (`ALL` = SELECT+INSERT+UPDATE+DELETE). El motor evalúa políticas SELECT como OR de todas las que apliquen, así que la policy permisiva de lectura sigue funcionando (`true OR is_platform_admin()`). No hay conflicto, pero es doble evaluación. Sin impacto funcional.

**No se ejecutó `SET LOCAL ROLE authenticated`** para probar en vivo — la lectura del pg_policy y el AND de RLS por rol lo garantizan.

---

## 4. Cabos sueltos en el resto del código

### 4a. `procesar-cancelacion` sigue mandando `p_credits: 2` literal
`supabase/functions/procesar-cancelacion/index.ts:1934` — **sí, y es correcto según el diseño aprobado**. Ahora es un fallback defensivo (si algún día se borrara la fila de `credit_prices`, la función sigue cobrando 2 en lugar de fallar). El servidor ya resuelve el valor real desde la tabla e ignora el `2` si hay match.
**Recomendación (no ejecutada)**: agregar comentario `// fallback si credit_prices no tiene fila; server resuelve el real` para que un futuro colaborador no confunda el `2` con autoridad de precio.

### 4b. Frontend: ¿alguien muestra un número fijo de créditos al usuario?
Búsqueda exhaustiva por `OCR_DOCUMENTO`, `APERTURA_EXPEDIENTE`, `GENERACION_DOCX`, `unlock_expediente`, `p_credits`:
- `src/services/credits.ts:33` → `p_credits: opts.credits ?? 1` — no muestra al usuario, solo pasa como fallback al RPC.
- `src/pages/Team.tsx:253-255, 487-489` → **solo labels de UI** ("OCR documento", "Apertura expediente", "Generación Word") para filtrar el histórico de consumo. **No muestra costos hardcodeados.**
- `src/pages/Validacion.tsx:1854` → llama `unlock_expediente` sin pasar créditos (bien).
- `src/pages/Validacion.tsx:1390` → `action: "OCR_DOCUMENTO"` sin pasar `p_credits` (usa default 1).
- `src/pages/CancelacionValidar.tsx:513` → solo comentario "No cobra créditos (unlock_expediente ya consumió los 2)".

🚨 **Cabo suelto real (bajo)**: **el usuario nunca ve cuánto le va a costar una acción antes de confirmarla.** El diseño original propuso un hook `useCreditPrices()` cacheado 5 min para UI; no está implementado. Hoy el usuario se entera del costo cuando ya se debitó (o cuando ve `CreditsBlockedModal` post-402). No es un bug, es UX pendiente.

🚨 **Cabo suelto real (bajo)**: el comentario en `CancelacionValidar.tsx:513` y `procesar-cancelacion/index.ts:1640` dice literalmente "los 2 créditos" — se volverá desincronizado si el precio cambia. Comentarios legacy, no lógica.

---

## 5. Errores TypeScript preexistentes en `procesar-cancelacion/index.ts`

Los 5 errores están **completamente desconectados del cambio de créditos** (no tocan `consume_credit_v2`, `unlock_expediente`, ni `credit_prices`).

| # | Línea | Código TS | Naturaleza | Riesgo runtime |
|---|---|---|---|---|
| 1 | 822 | TS2345 | `deudoresArr: {genero: string}[]` pasado a `deudoresTokens()` que espera `{genero?: GeneroGramatical}[]` (union `"M"\|"F"\|""`) | **Bajo.** JS descarta el tipado; si `genero` viene `"M"` o `"F"` funciona; si viene otra string, `deudoresTokens` probablemente cae a rama default. No crash. |
| 2 | 829 | TS2345 | Mismo patrón: `d.genero: string` pasado a `deudorTokens()` que espera `GeneroGramatical \| undefined` | **Bajo.** Mismo argumento. |
| 3 | 1840 | TS2322 | `resultado` construido con template literal `` `fallo_${number}` `` (ej. `"fallo_413"`, `"fallo_red"`) asignado a campo tipado `"exito"\|"fallo"\|"no_aplica"\|"sin_escritura"` | **Bajo-medio.** Se pasa a `logCuantiaEvent()` que hace `insert` en `system_events`. Si la columna destino es `text` sin CHECK, entra sin problema; el string "fallo_413" queda en el log. Si algún consumidor filtra por los 4 valores canónicos, no encuentra estas variantes. |
| 4 | 2127 | TS2322 | Idéntico al #3, otra llamada a `logCuantiaEvent` | Idem. |
| 5 | 2157 | TS2322 | Asignación de array `{genero: string}[]` a campo `{genero?: ""\|"M"\|"F"}[]` en `extracted.partes.deudores` | **Bajo.** El campo `extracted.partes.deudores.genero` viaja como string a plantilla docx / prosa. Si el clasificador entrega correctamente `"M"`/`"F"`, plantilla renderiza bien. Riesgo real solo si upstream mandara algo como `"masculino"` — se colaría sin normalizar. |

**Conclusión**: son 5 fallas de tipado por unions estrechados aguas abajo que no se propagaron aguas arriba. Ningún caso genera excepción JS en producción bajo datos válidos. Deuda técnica de tipos, no bugs. La verificación con `deno test` cae en `--check` estricto antes de siquiera ejecutar tests; **con `--no-check` los tests correrían**. La corrección genuina es tipar `deudoresArr` con `GeneroGramatical` desde el normalizador y ensanchar la union del `resultado` de `logCuantiaEvent` a los variantes reales `fallo_*`.

---

## Resumen ejecutivo

- ✅ SQL post-migración = diseño aprobado, sin desviaciones.
- ✅ Seed correcto (OCR=1, escritura=3, cancelación=2).
- ✅ RLS bloquea escritura a no-super-admins.
- ✅ Edge cases 1, 2, 3, 5 se comportan como se diseñó.
- ⚠️ Cabo suelto operacional: `UNIQUE(action, tipo_acto)` sin considerar `active` → reactivar por INSERT vs UPDATE es un footgun.
- ⚠️ Cabo suelto UX: usuario no ve precio antes de acción (falta `useCreditPrices()`).
- ⚠️ Cabo suelto cosmético: 2 comentarios legacy mencionan "2 créditos" literal.
- ⚠️ Los 5 errores TS de `procesar-cancelacion` son preexistentes, sin impacto runtime bajo datos válidos, bloquean el type-check estricto de Deno pero no la ejecución.

Sin cambios aplicados. Esperando priorización.
