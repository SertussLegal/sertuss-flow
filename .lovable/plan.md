
# Diseño — Fix de raíz del Poder General en Cancelaciones

Solo diseño. Nada se ejecuta. Cada prioridad lista: archivos, cambio, riesgo y verificación.

---

## P1 — Bug de rasterizado (JPEGs uniformes de 12.192 bytes)

### Diagnóstico línea a línea (`src/lib/pdfToImages.ts`)

Puntos donde un JPEG "placeholder" puede colarse sin error visible:

1. **L46 `pdf.getPage(i)`** — si tira, aborta todo el bucle: no es la causa (no produciría 25 JPEGs).
2. **L48 `Math.min(2, maxDimension / longest)`** — con un PDF donde `longest` sea ridículamente grande, `scale` cae a un valor mínimo. No colapsa a 0, pero puede dar canvas diminuto.
3. **L53–56 `canvas.getContext("2d", { alpha:false })`** — si falla, lanza. OK.
4. **L60 `page.render(...).promise`** — PDF.js con `page.render` puede **rechazar por "Rendering cancelled"** o "Transport destroyed" si `pdf.cleanup()`/`pdf.destroy()` del bucle anterior no terminó, o por OOM en Chrome móvil. La promesa se resolvería mal pero llegaría a `toBlob`.
5. **L62 `canvas.toBlob(..., "image/jpeg", 0.75)`** — **Este es el punto crítico**: si el canvas quedó en blanco por un `render` que abortó silenciosamente, `toBlob` sigue devolviendo un JPEG válido (blanco/opaco). 25 canvas blancos idénticos = **25 blobs con MD5 idéntico y tamaño idéntico** → exactamente el patrón "12.192 bytes ×25" observado.
6. **L72 `page.cleanup()`** — no invalida el canvas ya renderizado; no es la causa.
7. **No hay `try/catch` por página** — un error de `render` en cualquier iteración corta todo el proceso pero **no se detecta cuando `render` "resuelve" con un canvas en blanco** (caso principal).

### Hipótesis principal
`page.render` está retornando su promesa antes de pintar en dispositivos con memoria baja o con la nueva API v4 de PDF.js que rompió la firma `{ canvasContext, viewport, canvas }` — pdfjs-dist ≥4.x requiere solo `{ canvasContext, viewport }` (el 3.er param `canvas` es ignorado o rompe silenciosamente en algunas builds).

### Reproducción sin PDF de Alejandra
- **Test A** (síntoma exacto): subir cualquier PDF ≥20 páginas al flujo de Cancelaciones desde móvil o pestaña de Chrome con throttling de memoria (DevTools → Performance → "Low-end mobile"), inspeccionar los objetos en `expediente-files/{id}/cancelaciones/soportes/poder/pXX.jpg` y comparar tamaños con `curl -sI | grep Content-Length`. Si todos idénticos → confirmado.
- **Test B** (aislado): crear `src/lib/pdfToImages.test.ts` con un PDF fixture generado por `pdfkit` de 3 páginas con contenido diferente (texto distinto), correr `pdfToImages` en jsdom+canvas mock, y assert que `blob.size` de las 3 páginas sea distinto entre sí (>±5%).
- **Test C** (versión de pdfjs): `bun pm ls pdfjs-dist` para ver si es ≥4.x — si sí, la firma de `render` cambió y la teoría es correcta.

### Fix propuesto
Archivo: `src/lib/pdfToImages.ts`
1. Reemplazar `page.render({ canvasContext: ctx, viewport, canvas })` por `page.render({ canvasContext: ctx, viewport }).promise` (sin `canvas`).
2. Envolver cada iteración en `try/catch`: al fallar una página, arrojar `PdfPageRenderError(pageNumber, cause)` — que la UI muestre "Página 12 no se pudo renderizar; reduce tamaño o divide el PDF" en vez de continuar.
3. **Validación forense post-render**: antes de `toBlob`, muestrear píxeles (`ctx.getImageData(w/2, h/2, 1, 1)`) — si el canvas es 100% blanco/uniforme, tirar `EmptyCanvasError` explícito. Evita el modo silencioso.
4. Añadir asserción de tamaño mínimo: `if (blob.size < 3000) throw ...` (un JPEG con contenido real de página nunca baja de ~15 KB a 1600 px lado mayor).

### Riesgo de regresión
Bajo. Cambio localizado a un helper puro. Rollback = revertir el archivo.

### Verificación
- Test unitario nuevo (Test B arriba) — vitest.
- Prueba manual: re-subir un poder real de 10 páginas en preview y verificar que los blobs en storage tienen **tamaños dispares** (variación >20% pico-valle) y que las páginas 20+ son legibles al abrirlas.

---

## P2 — Límite de 25 páginas (`PODER_MAX_PAGES`)

### Origen del límite
`src/pages/CancelacionNueva.tsx` L25. Se puso al cablear el pipeline v5/v6 para acotar RPM del gateway (Gemini 2.5 Flash cobra por página y hay techo de contexto). No hay comentario justificándolo — es un tope defensivo, no un límite físico.

### Opciones y recomendación

| Opción | Trade-offs |
|---|---|
| A. Subir a 50 páginas | Cubre >95% de poderes reales; costo por trámite sube ~2×; sin cambios de arquitectura. |
| B. Quitar el tope y trocear en batches de 20 páginas con múltiples llamadas a Gemini + merge | Cubre 100%; latencia sube (2–3 llamadas secuenciales); requiere lógica de merge dedupe; complejidad alta. |
| **C. Recomendada: A + telemetría + aviso duro si excede** | Simple, resuelve el caso conocido (Alejandra: 25), deja B para cuando aparezcan poderes de 40+ que hoy no tenemos evidencia de que existan. |

### Diseño del cambio (Opción C)
Archivos:
- `src/pages/CancelacionNueva.tsx`: subir `PODER_MAX_PAGES` de 25 a 50. Cambiar copy del `FileDropzone` para reflejar 50. Añadir **validación pre-envío** que lea `pdfjs.getDocument(file).numPages` antes de rasterizar y, si excede 50, toast bloqueante: *"El Poder tiene N páginas y el límite es 50. Divide el PDF o comprime."* — no truncar silenciosamente.
- `supabase/functions/scan-document/core/poderBanco/prompt.ts` L10: cambiar "hasta 30 páginas" por "hasta 50".
- `supabase/functions/procesar-cancelacion/index.ts` L284: cambiar copy "hasta 25 páginas".

### Riesgo
Costo IA por poder ~2× en peor caso. `system_events` ya rastrea `paginas_enviadas` — mide impacto real en 1 semana.

### Verificación
- Subir poder de 35 y 48 páginas, confirmar que el pipeline completa y `data_ia.poder_banco.apoderado_nombre` sale poblado.
- Subir poder de 60, confirmar toast bloqueante sin creación de borrador ni cargo de créditos.

---

## P3 — Cablear el extractor v6 (schema profundo) al flujo de cancelaciones

### Problema actual
`procesar-cancelacion/index.ts` L1180–1256 tiene su propio tool `extract_poder_banco_dedicado` con schema **plano** (5 campos) y su propio system prompt. El schema profundo (`apoderados[]`, `poderdante`, `apoderado.tipo`, `sociedad_constitucion`, etc.) vive en `scan-document/core/poderBanco/{tool,prompt,handler}.ts` y **no se invoca desde cancelaciones**. Por eso `TEMPLATE_MINUTA_V3` nunca se dispara (L61–68 requiere `data.poder_banco.apoderado.tipo`).

### Diseño

**Paso 1 — Extraer el extractor v6 a `_shared/isomorphic/`:**
Nuevo módulo `supabase/functions/_shared/isomorphic/poderBancoExtractor/` con:
- `tool.ts` — mover el schema desde `scan-document/core/poderBanco/tool.ts` (código Deno puro, sin dependencias de infra).
- `prompt.ts` — mover el prompt.
- `index.ts` — función pura `buildPoderBancoRequest(pages: string[]) → { messages, tools, tool_choice }` para ser llamada tanto desde `scan-document` como desde `procesar-cancelacion`.
- Re-export desde `scan-document/core/poderBanco/*` con `export * from "@shared/poderBancoExtractor/..."` para no romper llamadas actuales.

**Paso 2 — Reemplazar `extractPoderBancoDedicado` en `procesar-cancelacion`:**
- Sustituir el tool plano por el request del módulo compartido.
- Al recibir la respuesta, aplicar `classifyApoderado(payload.apoderado)` (ya existe) para consolidar `apoderado.tipo`.
- Poblar tanto los **campos planos legacy** (via el mapeo que ya define `poderBanco/prompt.ts` L82–93) **como el bloque profundo** en `data_ia.poder_banco`.

**Paso 3 — Selector de plantilla:**
`selectMinutaTemplate()` (L61–68) ya lee `data.poder_banco.apoderado.tipo`. Una vez P3 puebla ese campo, v3 se dispara sola cuando `POWER_V5_ENABLED=true`.

**Paso 4 — UI (`CancelacionValidar.tsx` + `ProsaLiveRenderer`):**
- El schema plano legacy sigue mostrándose tal cual (backward-compat).
- Si `data_final.poder_banco.apoderado.tipo === "juridica"`, `ProsaLiveRenderer` ya sabe renderizar la cadena (código isomórfico existente en `_shared/isomorphic/prosaBancos/davivienda.ts`).
- **Cambio mínimo requerido en UI**: exponer en `PoderViewerTab` un panel plegable "Cadena de representación (v6)" que muestre `poderdante`, `apoderado.tipo`, `sociedad_constitucion`, `representantes[]`. Solo lectura; edición avanzada queda para siguiente iteración.

### Riesgo de regresión
Medio. El extractor profundo puede devolver `null` en campos que el plano rellenaba. Mitigación: mantener `mergePoderBanco` (L1260–1285) y priorizar valores no-null del profundo sobre los planos. Añadir feature-flag `POWER_V6_EXTRACTOR_ENABLED` (default `false`) para rollout gradual — ortogonal a `POWER_V5_ENABLED` (que controla caché + plantilla).

### Testing
- Test unitario `procesar-cancelacion/poder_v6.test.ts` con fixture JSON simulando respuesta de Gemini con `apoderado.tipo="juridica"` y confirmar que:
  1. `data_ia.poder_banco.apoderado.tipo === "juridica"`.
  2. `data_ia.poder_banco.apoderado_nombre` = primer representante (fallback plano correcto).
  3. `selectMinutaTemplate()` devuelve `TEMPLATE_MINUTA_V3` cuando ambos flags están on.
- **Test sintético del caso Alejandra**: fixture de 30 páginas donde la designación aparece en página 28. Confirmar que el extractor v6 (con `poderBancoPrompt` que exige revisar TODAS las páginas) devuelve `apoderado.nombre` correcto, mientras que el plano actual (validado ahora) lo dejaría null si truncara.

---

## P4 — Activar `POWER_V5_ENABLED`

Precondición: P1, P2, P3 en verde en preview.

### Diseño
- Fase 1: activar en preview vía secret `POWER_V5_ENABLED=true` en edge y `VITE_POWER_V5_ENABLED=true` en cliente (ya default `true`).
- Fase 2: correr 3 cancelaciones reales con poder (una natural, una jurídica, una sin poder). Validar:
  - `ocr_raw_cache` recibe filas con `schema_version="poder_banco_v6"`.
  - `TEMPLATE_MINUTA_V3` se selecciona solo cuando corresponde.
  - Cache hit en el 2º intento con el mismo PDF (bajar costo).
- Fase 3: activar en prod, monitorear `system_events` categoría `POWER_CACHE_HIT|MISS` durante 48 h.

### Rollback
Setear la env var a `false` y redeploy. Datos en `ocr_raw_cache` quedan como registros inertes; `selectMinutaTemplate` vuelve a v2.

---

## P5 — Higiene de nombres

### Estado actual (confuso)
- Edge: `POWER_V5_ENABLED` (default `false`) — controla caché + selector de plantilla.
- Cliente: `VITE_POWER_V5_ENABLED` (default `true`) — usado por `src/lib/featureFlags.ts` para banners UI.
- Schema: `POWER_SCHEMA_VERSION = "poder_banco_v6"` — dice v6 pero el flag dice v5.

### Propuesta (sin romper nada)
- Renombrar `POWER_V5_ENABLED` → `POWER_DEEP_SCHEMA_ENABLED` (edge). Deprecar el nombre viejo leyendo ambas env vars 30 días.
- Renombrar `VITE_POWER_V5_ENABLED` → `VITE_POWER_DEEP_UI_ENABLED`.
- Añadir constante nueva `POWER_V6_EXTRACTOR_ENABLED` (de P3) — ortogonal.
- Documentar en `_shared/poderBancoSchemaVersion.ts` la matriz de flags: schema (dato), extractor (código), UI (renderizado), caché (persistencia).

### Riesgo
Mínimo. Con la lectura dual durante 30 días no rompe deployments.

---

## Validación final con el caso de Alejandra

No tenemos el PDF original. Plan de aceptación:

1. Producto contacta a Alejandra: *"El fix está en preview; ¿nos re-envías el mismo poder que fallaba en junio (o uno equivalente, largo, con designación al final)?"*.
2. Sertuss carga el PDF vía preview con `POWER_V5_ENABLED=true` y `POWER_V6_EXTRACTOR_ENABLED=true`.
3. Verificación de aceptación en un solo pantallazo:
   - JPEGs generados con tamaños dispares (P1 OK).
   - `data_ia.poder_banco.apoderado.tipo` poblado.
   - `TEMPLATE_MINUTA_V3` seleccionado.
   - Minuta descargable con la antefirma correcta.
4. Screenshot + hash del PDF quedan en `system_events` como evidencia trazable.
5. Solo entonces se marca B3 como "verificado end-to-end con caso real".

---

## Resumen de archivos afectados

| Prioridad | Archivos |
|---|---|
| P1 | `src/lib/pdfToImages.ts` + nuevo `src/lib/pdfToImages.test.ts` |
| P2 | `src/pages/CancelacionNueva.tsx`, `supabase/functions/scan-document/core/poderBanco/prompt.ts`, `supabase/functions/procesar-cancelacion/index.ts` (copy) |
| P3 | Nuevo `supabase/functions/_shared/isomorphic/poderBancoExtractor/*`, edit `supabase/functions/scan-document/core/poderBanco/*` (re-export), edit `supabase/functions/procesar-cancelacion/index.ts` (reemplazar `extractPoderBancoDedicado`), edit `src/components/cancelaciones/PoderViewerTab.tsx` (panel v6 lectura), nuevo test |
| P4 | Solo secrets + observación de `system_events`; no toca código |
| P5 | `supabase/functions/_shared/poderBancoSchemaVersion.ts`, `src/lib/featureFlags.ts`, doc |

---

## Orden de ejecución sugerido

P1 (día 1) → P2 (día 1) → P3 (día 2–3, con feature-flag off en prod) → validación con Alejandra en preview → P4 (activar en prod) → P5 (higiene, sin urgencia).
