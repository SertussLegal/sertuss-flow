
# Plan — Parche `merge.ts` + Fase E (bloqueo duro con override manual)

## Parte 1 — Parche `merge.ts` (NO_LEGIBLE fuerza al plano)

### Diagnóstico confirmado
Cuando `deepV6.apoderado_cedula` (o `apoderado.cedula`) llega como `"NO_LEGIBLE"`, `classifyApoderado` interpreta la cédula como no válida y degrada `tipoEfectivo` a `null`. El bloque V6-wins (líneas 145–157 de `merge.ts`) exige `cls.tipoEfectivo !== null` para sobrescribir, así que el `finalFlat.apoderado_cedula` conserva el valor del monolítico (potencialmente alucinado). El banner ámbar sí se dispara porque `validate.ts` inspecciona el bloque profundo, pero el plano que usa la minuta queda con basura.

### Cambio (archivo único)
`supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts`

Después del bloque "V6-wins override" y el "Fallback legacy" (línea ~169), añadir un **override incondicional NO_LEGIBLE** que corre siempre que exista `deepV6`, independiente de `tipoEfectivo`:

```ts
// NO_LEGIBLE override: si el bloque profundo declaró explícitamente que un
// campo crítico es ilegible, esa señal SIEMPRE gana sobre el plano monolítico.
// Corre incluso cuando el classifier degradó tipoEfectivo a null (ese es
// justamente el caso donde el monolítico podría estar alucinando).
if (deepV6) {
  const deepCedula = unwrapConf(deepV6.apoderado_cedula) 
    ?? (apoderadoIn?.cedula ? String(apoderadoIn.cedula) : null);
  const deepEscritura = unwrapConf(deepV6.escritura_poder_num)
    ?? (deepV6.instrumento_poder?.escritura_num 
        ? String(deepV6.instrumento_poder.escritura_num) 
        : null);
  const deepFecha = unwrapConf(deepV6.fecha_poder)
    ?? (deepV6.instrumento_poder?.fecha 
        ? String(deepV6.instrumento_poder.fecha) 
        : null);

  if (deepCedula === "NO_LEGIBLE") finalFlat.apoderado_cedula = "NO_LEGIBLE";
  if (deepEscritura === "NO_LEGIBLE") finalFlat.apoderado_escritura = "NO_LEGIBLE";
  if (deepFecha === "NO_LEGIBLE") finalFlat.apoderado_fecha = "NO_LEGIBLE";
}
```

Nota: `sanitizeString(pick(...))` en `mergePoderBancoFlat` NO filtra `"NO_LEGIBLE"` (auditado en la ronda anterior); pero como el ganador del `pick` es siempre el monolítico si existe, sin este bypass el plano nunca ve el `NO_LEGIBLE` profundo. Este parche es el bypass.

### Test nuevo en `src/shared/poderBancoValidate.test.ts` (o crear `merge.test.ts` en el mismo folder si no existe uno)
Marcar el test que hoy documenta la limitación con `it("...")` y actualizar la aserción:

```ts
// ANTES documentaba: finalFlat.apoderado_cedula === "1234567" (monolítico gana)
// AHORA debe ser:   finalFlat.apoderado_cedula === "NO_LEGIBLE"
```

Fixture: monolítico con cédula `"41525143"` (valor alucinado), `deepV6.apoderado.cedula = "NO_LEGIBLE"`, `deepV6.apoderado.tipo = "natural"` sin datos suficientes para que el classifier devuelva un tipo firme. Assertion: `merged.apoderado_cedula === "NO_LEGIBLE"`.

Añadir un test paralelo por campo (escritura y fecha) y un test **de no-regresión**: cuando profundo NO trae `NO_LEGIBLE`, el comportamiento V6-wins/fallback previo se mantiene idéntico.

---

## Parte 2 — Fase E: bloqueo duro con override manual

### 2.a Migración SQL (esquema)

Patrón existente auditado: `cancelaciones` usa `created_by uuid` sin `_por` explícito. No hay columnas de "confirmado_por/fecha" en ninguna tabla del dominio. Propongo el patrón mínimo:

```sql
ALTER TABLE public.cancelaciones
  ADD COLUMN revision_manual_requerida boolean NOT NULL DEFAULT false,
  ADD COLUMN revision_manual_confirmada_at timestamp with time zone,
  ADD COLUMN revision_manual_confirmada_por uuid REFERENCES auth.users(id);

-- Ampliar el CHECK de status para admitir el nuevo valor.
ALTER TABLE public.cancelaciones
  DROP CONSTRAINT IF EXISTS cancelaciones_status_check;
ALTER TABLE public.cancelaciones
  ADD CONSTRAINT cancelaciones_status_check
  CHECK (status IN ('draft','processing','completed','error','requiere_revision_manual'));

-- Índice parcial: acelera "cancelaciones pendientes de revisión manual" en Admin.
CREATE INDEX IF NOT EXISTS cancelaciones_pend_revision_idx
  ON public.cancelaciones (organization_id, updated_at DESC)
  WHERE status = 'requiere_revision_manual';
```

Sin nuevos GRANTs (tabla existente, ya tiene RLS/GRANT). Sin nueva RLS (las políticas actuales aplican por `organization_id`).

**Semántica:**
- `revision_manual_requerida = true` cuando el pipeline detectó `NO_LEGIBLE` en post-merge.
- `revision_manual_confirmada_at` NULL hasta que el usuario aprieta "Confirmar revisión manual". A partir de ese momento se dispara la generación de minuta.
- `revision_manual_confirmada_por` para trazabilidad Ley 1581 (queda además espejo en `activity_logs`).

### 2.b Cambios en `procesar-cancelacion/index.ts`

**Detector (post-merge, antes de generar docx, ~línea 2517):**

```ts
const NO_LEGIBLE_PATHS = [
  extracted.apoderado_cedula,
  extracted.apoderado_escritura,
  extracted.apoderado_fecha,
  (extracted as any)?.apoderado?.cedula,
  (extracted as any)?.instrumento_poder?.escritura_num,
  (extracted as any)?.instrumento_poder?.fecha,
];
const requiereRevision = NO_LEGIBLE_PATHS.some(v => v === "NO_LEGIBLE");
```

**Bifurcación:**

- **Caso normal (`requiereRevision === false`):** cero cambio de comportamiento. Genera minuta+cert, sube al bucket, `status='completed'`, `url_minuta_generada` poblado. Idéntico al flujo actual.

- **Caso NO_LEGIBLE (`requiereRevision === true`):** 
  - **NO** generar ni subir minuta/certificado (`url_minuta_generada` queda NULL).
  - Persistir `data_ia`, `data_final`, todos los campos planos (matrícula, deudor, banco, etc.) **igual que hoy**, para que el usuario pueda editar en la pantalla de validación.
  - `status = 'requiere_revision_manual'`, `revision_manual_requerida = true`.
  - No restituir créditos (ya se cobró el análisis; la generación posterior no vuelve a cobrar).
  - Registrar `system_events` con `evento='procesar-cancelacion.revision_manual'`, `resultado='bloqueado'`, `detalle: { paths: [...] }`.

**Nueva acción `confirm_manual_review` (patrón idéntico a `regen` / `reprocess_poder`):**

```ts
if (bodyAny?.action === "confirm_manual_review") {
  // 1. Validar sesión + membresía (patrón ya usado en reprocess_poder).
  // 2. Cargar cancelaciones row; exigir status === 'requiere_revision_manual'.
  // 3. Marcar: revision_manual_confirmada_at=now(), revision_manual_confirmada_por=userId.
  // 4. Reusar el mismo bloque que genera minuta+cert (extraer en helper 
  //    `generateAndUploadDocs(data_final, cancelacionId)` para no duplicar).
  // 5. UPDATE status='completed', url_minuta_generada, url_certificado_generado.
  // 6. activity_logs: action='MANUAL_REVIEW_CONFIRMED', entity='cancelacion'.
  // 7. system_events: evento='procesar-cancelacion.revision_manual', 
  //    resultado='desbloqueado'.
  // 8. Responder { ok: true, unlocked: true }.
}
```

**Refactor mínimo asociado:** extraer el bloque `buildDocxVars → fillTemplate → upload → update` (líneas 2517–2558) a un helper `generateAndUploadCancelacionDocs(supabaseService, cancelacionId, data)` para que lo reusen (a) el flujo normal, (b) el `regen`, y (c) `confirm_manual_review`. Es el mismo código con tres llamadores.

### 2.c UI — `PoderBannersV5.tsx` + `CancelacionValidar.tsx`

**`PoderBannersV5.tsx`** (banner ámbar existente):
- Detectar si algún warning termina en `_no_legible` (`apoderado_cedula_no_legible`, `escritura_poder_no_legible`, `fecha_poder_no_legible`) → variable `hayNoLegible`.
- Nueva prop opcional `onConfirmManualReview?: () => Promise<void>` y `manualReviewPending?: boolean` (status del row).
- Si `hayNoLegible && manualReviewPending && onConfirmManualReview`: renderizar dentro del bloque ámbar existente el botón:
  ```
  [Confirmar revisión manual y generar documento]
  ```
  con `variant="default"`, `disabled` durante la petición, toast de éxito/error.
- Texto explicativo pequeño: "Al confirmar declaras que verificaste estos datos contra el documento original."

**`CancelacionValidar.tsx`** (línea 1104):
- Leer `cancelacion.status` y `cancelacion.revision_manual_requerida` del row cargado.
- Pasar `manualReviewPending={status === 'requiere_revision_manual'}` a `PoderBannersV5`.
- Handler `onConfirmManualReview` → `supabase.functions.invoke('procesar-cancelacion', { body: { cancelacionId, action: 'confirm_manual_review' } })` → refrescar row → toast.
- Bloquear (o ocultar) el botón "Generar documento" habitual mientras `status === 'requiere_revision_manual'` para forzar el único camino de confirmación.

### 2.d Análisis de riesgo (path normal)

**Confirmación explícita:** cero cambio para cancelaciones sin `NO_LEGIBLE`.
- `requiereRevision === false` → rama actual sin modificar (más allá del refactor a helper, que es idempotente).
- `revision_manual_requerida` default `false`, no rompe rows existentes.
- `status='completed'` sigue disparándose igual → UI actual no cambia.
- El nuevo botón sólo se pinta si `hayNoLegible && status==='requiere_revision_manual'`.
- La ampliación del CHECK de `status` es aditiva; rows existentes (`draft/processing/completed/error`) siguen válidos.

**Riesgo residual:** si un poder NO tiene `NO_LEGIBLE` pero el operador quisiera forzar revisión, no hay camino manual para bloquear. Fuera de alcance de esta fase.

### 2.e Trazabilidad
- `activity_logs`: dos nuevas acciones — `MANUAL_REVIEW_REQUIRED` (al detectar) y `MANUAL_REVIEW_CONFIRMED` (al confirmar). Metadata: paths NO_LEGIBLE detectados.
- `system_events`: dos hitos — `resultado='bloqueado'` y `resultado='desbloqueado'`.
- Cumplimiento Ley 1581 preservado (auditor ve quién confirmó y cuándo).

---

## Orden de ejecución propuesto (una vez apruebes)

1. Migración SQL (columnas + CHECK).
2. Parche `merge.ts` + test que cierra la limitación documentada.
3. Refactor `generateAndUploadCancelacionDocs` helper en `procesar-cancelacion`.
4. Detector `requiereRevision` + bifurcación de status.
5. Action `confirm_manual_review`.
6. Props + botón en `PoderBannersV5.tsx`.
7. Wire-up en `CancelacionValidar.tsx`.
8. `bunx vitest run` (esperar 165+ tests en verde).
9. Redespliegue de `procesar-cancelacion`.
10. Reporte con evidencia (diffs, tests, log de despliegue).

## Fuera de alcance (confirmado por ti)
- Ninguna modificación a `classifyApoderado` (el classifier sigue igual, el bypass va en merge).
- Ningún cambio en flujo cuando no hay `NO_LEGIBLE`.
- No se reintroduce Claude ni sugerencias automáticas de coherencia adicionales.
