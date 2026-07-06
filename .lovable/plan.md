# Diff propuesto — actualización de 3 comentarios legacy sobre créditos

Solo cambio de texto en comentarios. Cero cambios de lógica, cero cambios en `p_credits`, cero cambios en llamadas a funciones.

---

## 1. `supabase/functions/procesar-cancelacion/index.ts` — línea 1640

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

## 2. `supabase/functions/procesar-cancelacion/index.ts` — línea 1927 (comentario sobre la llamada de línea 1928-1935)

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

Nota: la línea `p_credits: 2` se mantiene intacta como fallback defensivo. Solo cambia el comentario de la línea 1927.

## 3. `src/pages/CancelacionValidar.tsx` — línea 513

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

## Verificación post-cambio

- Sin ejecución de tests requerida (cambios son puramente en comentarios; no afectan compilación ni runtime).
- Opcional: `bunx vitest run` y `deno check` para confirmar que nada se rompió por accidente en el editor.

## Riesgos

Ninguno. Los comentarios no afectan ejecución. El único riesgo sería un typo introducido al editar; el diff mostrado arriba es literal.

¿Apruebas aplicar exactamente este diff?
