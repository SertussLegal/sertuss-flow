
## Qué le pasa a Alejandra AHORA (evidencia)

- Cancelación `a8af7200`: `status='requiere_revision_manual'`, `revision_manual_requerida=true`, `error_message=null`, sin `url_minuta_generada`.
- `data_final.inmueble._coherencia_warnings` = `["inmueble_direccion_menciones_incoherentes","inmueble_matricula_menciones_incoherentes"]` (persistidos en el primer procesado a las 01:57:30 UTC).
- Últimas invocaciones a `procesar-cancelacion` en los últimos 30 min: **4× POST → 409** (todas del autosave, tiempos 1.1–1.3 s). Cero timeouts, cero 5xx, backend sano.
- `activity_logs`: un único `MANUAL_REVIEW_REQUIRED` con esos 2 motivos.
- La editión humana ya está sana: `nomenclatura_predio='CALLE 61 A SUR No. 100A-73 …'` y `matricula='50S-40470079'` pasan `isDireccionEditadaValida` y `isMatriculaValida`. Las menciones crudas divergentes (`50S-4043221` en cabida y una segunda variante en dirección catastral) siguen ahí como evidencia forense — es correcto.

## Causa raíz (código actual, no una regresión de hoy)

`generateAndUploadCancelacionDocs` corre el fail-safe `detectRequiereRevisionManual(data, { manualReviewConfirmed })` y aplica `MANUAL_OVERRIDE_RULES` **sólo cuando `manualReviewConfirmed===true`**. Esa flag únicamente se pasa desde la acción `confirm_manual_review`. El path `regen: true` que dispara el autosave cada 1500 ms **no** la pasa → el detector re-emite los 2 motivos → `ManualReviewRequiredError` → 409 → `parseManualReviewError` marca `previewStale=true` y sale silencioso. Resultado UX: chip "Guardando…" que reaparece con cada tecla, "Vista desactualizada" persistente, panel central vacío, y no aparece el botón de descarga porque los docs nunca se generan por esa ruta. El botón que sí desbloquea (`handleConfirmManualReview` → action `confirm_manual_review`) existe pero Alejandra no lo está tocando.

Los cambios de hoy (banner coherencia, merge V6, `syncApoderadoFlatWithNested`) no participan en este loop — el bloqueo es 100 % de los 2 warnings de inmueble y la asimetría flag `manualReviewConfirmed`.

## Qué decirle a Alejandra AHORA (respuesta inmediata, sin código)

1. Los datos que ya editó (dirección y matrícula) están correctos y son suficientes para desbloquear.
2. Debe pulsar el botón **"Confirmar revisión manual"** (Fase E) — no "Previsualizar/Generar". Con `confirm_manual_review` el servidor aplica `MANUAL_OVERRIDE_RULES`, suprime los 2 warnings y genera minuta + certificado en una sola llamada. No cobra créditos extra.
3. Si no encuentra el botón, hacer scroll dentro de `CancelacionValidar` — está gated por `row.status === "requiere_revision_manual"` y `revision_manual_requerida=true`, ambos true en su fila.
4. Backend sano, sin datos perdidos: `data_ia` y `data_final` completos con `poder_banco` presente. Nada que restaurar.

## Fix real (build posterior, requiere aprobación)

### Problema de diseño
Autosave silencioso regenera vía `regen:true` mientras el row está en `requiere_revision_manual`. Cada intento revive los mismos motivos y produce 409 + "Vista desactualizada" hasta que el usuario adivine que debe usar otro botón.

### Cambios propuestos (frontend-only, mínimos)

1. **`CancelacionValidar.tsx` — `persistData({silent:true})`:** cuando `row?.status === "requiere_revision_manual"`, saltar la llamada a `procesar-cancelacion` con `regen:true`. Persistir `data_final` con una escritura directa (update simple) o vía un nuevo modo `save_only` en la edge function. El objetivo: no regenerar el docx mientras el row esté bloqueado; sólo guardar campos.

2. **Banner visible cuando `revision_manual_requerida=true`:** mostrar un aviso persistente arriba del formulario con el CTA "Confirmar revisión manual y generar" (usa el handler existente `handleConfirmManualReview`), y listar los 2 motivos crudos con hint de qué campo editar. Reutiliza `parseManualReviewError` para el shape.

3. **Chip de estado:** cuando el row está bloqueado, `SaveStatusChip` debe mostrar "Bloqueado — falta confirmar revisión" en vez de "Guardando…". Un estado extra opcional (`blocked`) para no confundir con el ciclo dirty/saving/saved actual.

### Fuera de alcance de este plan
- Cambiar la semántica de `applyManualOverrideExceptions` para aplicarla también en `regen` (rompería el principio "Manual > OCR sólo cuando el humano confirmó explícitamente" y quitaría el gate de auditoría).
- Tocar `syncApoderadoFlatWithNested`, banners de coherencia u OCR — no participan en el bug.

### Verificación
- Manual: reproducir con `a8af7200` (o clonarlo) → editar dirección → confirmar que autosave ya no dispara 409, banner aparece, CTA genera docs, `status → completed` y `url_minuta_generada` poblado.
- Test: agregar caso en `index_manualOverride_test.ts` que valide que el path `regen:true` sigue devolviendo 409 (para no romper el gate) y un test de UI (opcional) que confirme el banner.

## Recomendación inmediata
Mandarle a Alejandra el paso 1–3 de arriba por chat ya mismo. El fix del banner + supresión de autosave-regen entra en un turno de build corto cuando ella confirme que pudo desbloquear.
