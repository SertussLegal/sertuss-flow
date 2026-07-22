# Plan — Jerarquía visual + a11y de la barra superior (CancelacionValidar)

Puntos 1–4 del plan aprobado. Solo frontend/presentación. Diffs exactos abajo.

---

## 1) `src/components/cancelaciones/SaveStatusChip.tsx`

Cambios:
- Nueva prop opcional `previewStale?: boolean`.
- Renombrar el copy verde: `"Documento actualizado"` → `"Guardado"`.
- Si `previewStale===true` y no hay `blocked/error/saving/dirty`, el chip **no renderiza nada** (`return null`) para no colisionar con el badge naranja externo.
- Actualizar el docblock (`"Guardado"` en vez de `"Documento actualizado"`).

Diff:

```diff
@@ interface SaveStatusChipProps {
   isDirty: boolean;
   saving: boolean;
   previewRefreshing: boolean;
   lastError: string | null;
   onRetry: () => void;
   /**
    * Cuando el row está en `requiere_revision_manual` el autosave no
    * puede regenerar (backend devuelve 409 hasta que el usuario confirme
    * la revisión). Mostramos un chip explícito en vez del ambiguo
    * "Guardando…" para que la usuaria sepa que debe pulsar el CTA del
    * banner y no espere a que se genere sola.
    */
   blocked?: boolean;
+  /**
+   * Cuando el .docx generado ya no refleja `data_final` (el usuario
+   * editó pero aún no se regeneró la vista) el estado global NO está
+   * "todo al día" aunque el formulario esté guardado. En ese caso el
+   * chip se oculta y dejamos que el badge naranja "Vista desactualizada"
+   * sea el único indicador de estado a la derecha de la barra.
+   */
+  previewStale?: boolean;
 }
@@
- *  - Verde (ok)      → "Documento actualizado"
+ *  - Verde (ok)      → "Guardado"
+ *  - Oculto          → previewStale (el badge naranja externo manda)
  */
 export function SaveStatusChip({
   isDirty,
   saving,
   previewRefreshing,
   lastError,
   onRetry,
   blocked,
+  previewStale,
 }: SaveStatusChipProps) {
-  // Prioridad: bloqueo > error > saving > dirty > sincronizado.
+  // Prioridad: bloqueo > error > saving > dirty > previewStale (oculto) > sincronizado.
   if (blocked && !saving) { ... }
   if (lastError) { ... }
   if (saving || previewRefreshing) { ... }
   if (isDirty) { ... }
+
+  // Formulario guardado pero el .docx generado quedó atrás: no pintamos
+  // el chip verde para no contradecir al badge naranja "Vista desactualizada".
+  if (previewStale) {
+    return null;
+  }
+
   return (
     <div role="status" aria-live="polite" className="... emerald ...">
       <CheckCircle2 className="h-3.5 w-3.5" />
-      <span>Documento actualizado</span>
+      <span>Guardado</span>
     </div>
   );
 }
```

---

## 2) `src/pages/CancelacionValidar.tsx` — call site del chip (línea 941)

```diff
             <SaveStatusChip
               isDirty={isDirty}
               saving={saving}
               previewRefreshing={previewRefreshing}
               lastError={saveError}
               onRetry={handleManualSave}
               blocked={row?.status === "requiere_revision_manual"}
+              previewStale={previewStale}
             />
```

---

## 3 y 4) `src/pages/CancelacionValidar.tsx` — badge "Vista desactualizada" (línea 921–927)

Cambios:
- Añadir `role="status"` + `aria-live="polite"` para que lectores de pantalla anuncien cuando el docx queda desfasado.
- Reemplazar `title=` por `aria-label` (patrón accesible: el `title` HTML nativo no lo lee NVDA/VoiceOver de forma confiable). Como el texto visible "Vista desactualizada" es corto y auto-explicativo, el `aria-label` extiende la explicación para ATs sin romper visualmente. No se introduce Radix Tooltip aquí para no cambiar el layout de la barra (no lo pediste).

```diff
             {previewStale && !previewRefreshing && (
               <span
+                role="status"
+                aria-live="polite"
                 className="text-[11px] flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-400"
-                title="Los cambios se guardaron, pero el documento mostrado puede estar desactualizado. Pulsa Regenerar."
+                aria-label="Vista desactualizada: los cambios se guardaron, pero el documento mostrado puede estar desactualizado. Pulsa Regenerar."
               >
                 <AlertTriangle className="h-3 w-3" /> Vista desactualizada
               </span>
             )}
```

---

## 5) Tests afectados

Búsqueda ejecutada: `rg "Documento actualizado|Vista desactualizada"` en `src/`.

- **Ningún test** referencia el literal `"Documento actualizado"` ni `"Vista desactualizada"`. Las únicas coincidencias son en el propio `SaveStatusChip.tsx` (docblock + span) y en `CancelacionValidar.tsx` (comentario + span).
- `src/pages/Cancelaciones.test.tsx` prueba badges de la lista (`"Completada"`, `"Bloqueada"`, `"Alertas"`, etc.), no toca el chip de la vista de validación.
- El toast `toast.success("Documento actualizado")` en `CancelacionValidar.tsx:662` es otro string (post-regen manual) y **no se toca** en este cambio — es un evento puntual, no un estado ambiguo.

Conclusión: **no hay que actualizar tests existentes**. Opcionalmente podríamos añadir un test unitario nuevo para `SaveStatusChip` que verifique `previewStale && !isDirty && !saving → null`, pero no está en el alcance pedido.

---

## 6) Plan de verificación

1. **Typecheck + tests automáticos:**
   - `bunx vitest run` (verificar que ninguna suite rompe — especialmente `Cancelaciones.test.tsx` y las suites de `prosaBancos/`).
2. **Prueba manual en preview con el trámite `a8af7200`:**
   - Abrir `/cancelaciones/a8af7200-cbb5-4bf8-9649-45f29949733d`.
   - Editar un campo cualquiera del formulario (ej. nombre del deudor) y esperar a que autoguarde.
   - **Esperado:** la barra superior derecha muestra únicamente el badge naranja **"Vista desactualizada"** (con lector de pantalla anunciándolo vía `aria-live`) + botón azul "Regenerar". **No** debe verse el chip verde "Guardado" simultáneamente.
   - Pulsar "Regenerar". Tras completar: el badge naranja desaparece y el chip verde pasa a mostrar **"Guardado"** (copy nuevo).
   - Con VoiceOver/NVDA activo, hover sobre el badge naranja debe leer el texto largo del `aria-label` (no solo "Vista desactualizada").
3. **Regresión rápida:** verificar que `blocked` (status `requiere_revision_manual`), `saving`, `error` y `dirty` siguen pintando sus chips respectivos sin cambios.

---

## Notas técnicas

- El chip devolver `null` cuando `previewStale` es intencional: mantiene el "un solo mensaje dominante" pedido en el análisis P0, sin fusionar los dos sistemas de estado (queda como P3 opcional futuro).
- No se toca lógica de negocio, ni `persistData`, ni edge functions. Solo copy + prop + atributos ARIA.
