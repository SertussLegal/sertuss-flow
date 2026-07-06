# Cambio combinado: comentarios legacy de créditos + COMMENT ON TABLE credit_prices

Solo documentación. Cero cambios de lógica, cero cambios en `p_credits`, cero cambios en llamadas a funciones ni en estructura de la tabla.

---

## Parte 1 — Comentarios TypeScript

### 1.1. `supabase/functions/procesar-cancelacion/index.ts` — línea 1640

```diff
     // ─────────────────────────────────────────────────────────────
     // MODO REPROCESS_PODER: re-extrae solo el Poder con OCR dedicado.
     // Idempotente: limpia data_ia.poder_banco antes de re-inyectar.
-    // No cobra créditos (unlock_expediente ya consumió los 2).
+    // No cobra créditos adicionales: el costo de generación ya fue cubierto
+    // por unlock_expediente al abrir el expediente. El número de créditos
+    // lo determina credit_prices, no un valor fijo aquí.
     // ─────────────────────────────────────────────────────────────
```

### 1.2. `supabase/functions/procesar-cancelacion/index.ts` — línea 1927

```diff
-    // 1) Cobro de 2 créditos (con auditoría obligatoria → p_tramite_id requerido)
+    // 1) Cobro de créditos (auditoría obligatoria → p_tramite_id requerido).
+    // Fallback defensivo: el precio real lo resuelve credit_prices en el servidor
+    // (consume_credit_v2). El valor p_credits: 2 solo aplica si la tabla no
+    // tuviera una fila activa para GENERACION_DOCX / cancelacion_hipoteca.
     const { data: charge, error: chargeErr } = await supabaseUser.rpc("consume_credit_v2", {
       p_org_id: orgId,
       p_user_id: userId,
       p_action: "GENERACION_DOCX",
       p_tramite_id: cancelacionId,
       p_tipo_acto: "cancelacion_hipoteca",
       p_credits: 2,
     });
```

La línea `p_credits: 2` se mantiene intacta como fallback defensivo.

### 1.3. `src/pages/CancelacionValidar.tsx` — línea 513

```diff
     // Re-procesar SOLO el Poder General con OCR dedicado. Idempotente
     // (la edge function limpia data_ia.poder_banco antes de re-inyectar).
-    // No cobra créditos (unlock_expediente ya consumió los 2).
+    // No cobra créditos adicionales: el costo de generación ya fue cubierto
+    // por unlock_expediente al abrir el expediente. El número de créditos
+    // lo determina credit_prices, no un valor fijo aquí.
     const handleReprocessPoder = async () => {
```

---

## Parte 2 — SQL: `COMMENT ON TABLE public.credit_prices`

Migración de metadatos (no toca datos ni estructura):

```sql
COMMENT ON TABLE public.credit_prices IS
'Catálogo autoritativo de precios en créditos por acción y tipo_acto. Resuelto server-side por consume_credit_v2 y unlock_expediente (prioridad: match exacto tipo_acto > comodín "*" > p_credits del cliente > fallback 1). Escritura restringida a is_platform_admin() vía RLS. IMPORTANTE: para reactivar un precio desactivado, usar UPDATE ... SET active = true sobre la fila existente — NUNCA insertar una fila nueva con la misma combinación (action, tipo_acto), ya que violará el constraint UNIQUE credit_prices_action_tipo_unique.';
```

Se ejecutará vía la herramienta de migración (única forma soportada para cambios de esquema/metadatos). No modifica filas, columnas, constraints, políticas ni funciones.

---

## Impacto operacional (dejarlo documentado, no asumido)

- **`procesar-cancelacion/index.ts` requerirá redeploy** de la edge function tras aplicar los cambios de comentarios, aunque no cambie lógica. Deno bundlea el archivo completo; cualquier cambio textual dispara redespliegue en el próximo push.
- **`src/pages/CancelacionValidar.tsx`**: rebuild normal del frontend (Vite), sin impacto en producción hasta el próximo deploy.
- **`COMMENT ON TABLE`**: se aplica inmediatamente al ejecutarse la migración. Sin efecto en runtime ni en clientes conectados.

## Verificación post-cambio (a ejecutar en build mode tras aprobación)

- `bunx vitest run` — suite frontend completa, para confirmar verde a pesar de que el cambio es solo textual.
- No se requiere `deno check` adicional (los comentarios no afectan tipos; los 5 errores TS preexistentes de `procesar-cancelacion` siguen sin relación).

## Riesgos

Ninguno funcional. Único riesgo: typo al aplicar el diff — mitigado porque el texto propuesto está literal arriba y se aplicará con reemplazo exacto.

¿Apruebas aplicar este cambio combinado (3 comentarios + 1 COMMENT ON TABLE)?
