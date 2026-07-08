# Auditoría solo-lectura: origen de los JPGs ilegibles del poder

## Respuestas directas a las 5 preguntas

### 1) Pipeline completo PDF → JPG

**Dónde vive:** todo el pipeline corre **client-side (navegador)**. No hay ninguna conversión server-side.

- **Punto de entrada:** `src/pages/CancelacionNueva.tsx:57`
  ```ts
  const pages = await pdfToImages(file, { maxPages });
  // línea 61: basePath = `${cancelacionId}/cancelaciones/soportes/${kind}`
  // líneas 63-71: sube `p.blob` como JPEG directamente al bucket expediente-files (upsert)
  ```
  Constantes en el mismo archivo (líneas 21-26): `MAX_PODER_BYTES = 40 MB`, `PODER_MAX_PAGES = 50`.

- **Renderizador:** `src/lib/pdfToImages.ts` (líneas 103-189)
  - Librería: `pdfjs-dist` v5 (import línea 19, worker línea 21)
  - Config default (líneas 25-32): **`maxDimension = 1600 px`, `jpegQuality = 0.75`, `maxPages = 10`** (para el poder se sobrescribe a 50)
  - Pipeline por página (líneas 116-183): `getPage → getViewport(scale) → canvas 2D → page.render({canvasContext, viewport, canvas}) → canvas.toBlob('image/jpeg', 0.75)`
  - Scale calculado (línea 122): `Math.min(2, 1600 / longest_side)` — es decir, downsampling hacia máximo 1600 px lado largo.

- **Original PDF: NO se persiste.** El código sube directamente los JPGs. No hay ningún `.upload(..., pdfFile)` para el poder. Se pierde inmediatamente al terminar el submit.

### 2) Caso 748f3220: ¿existe el PDF original?

**No.** Verifiqué el listado completo del bucket para ese `cancelacion_id`:

```
748f3220-…/cancelaciones/soportes/certificado/p01..p03.jpg  (137-358 KB — sanos)
748f3220-…/cancelaciones/soportes/escritura/p01..p10.jpg    (243-320 KB — sanos)
748f3220-…/cancelaciones/soportes/poder/p01..p28.jpg        (28 × 12192 bytes exactos — placeholder)
```

Solo sobreviven los JPGs derivados. No hay `.pdf` en storage. Recuperar el original desde el usuario es la única opción de "obtener la fuente real" para este caso.

### 3) ¿Por qué el poder pesa 12192 bytes/pág y los otros documentos no?

**Es el bug documentado en el propio `pdfToImages.ts` (líneas 9-18) que oficialmente estaba "arreglado":**

> "En pdfjs-dist ≥4/5 la firma de `page.render` ya no acepta un 3.er param `canvas`; pasarlo hacía que el render resolviera sin pintar y `toBlob` generaba **25 JPEGs blancos idénticos (~12 KB c/u)**"

Los 28 JPGs del caso 748f3220 tienen tamaño **exactamente 12192 bytes** — la firma del bug histórico. El fix en línea 135 (`page.render({ canvasContext: ctx, viewport, canvas })`) sí pasa `canvas` como propiedad (lo requerido en v5) — así que el bug _general_ está arreglado. Pero:

- **El caso 748f3220 quedó grabado antes o durante alguna regresión** (creado 2026-07-08 14:01, muy reciente). Certificado y escritura pasaron por el mismo `pdfToImages` con éxito en el mismo submit; solo el poder falló → sospechoso: puede ser un caso donde `page.render` resolvió sin pintar solo para ese PDF (PDF cifrado, PDF con XFA, PDF con solo formularios acroform, etc.).
- **El guard actual NO lo atrapa:** `MIN_JPEG_BYTES = 1500` (línea 63) y `HEALTHY_JPEG_BYTES = 8000` (línea 71). 12192 > ambos umbrales → pasa silencioso. Además la asserción `uniform && blob.size < 8000` (línea 159) no dispara porque 12192 > 8000.
- **No hay registro de error:** en `activity_logs` solo aparece la fila `MANUAL_REVIEW_REQUIRED_RETRO` de hoy (auditoría de warnings), no hay log de fallo de renderización para este trámite. `logs_extraccion` no tiene columna de mensaje/status; solo `data_ia`/`data_final` y no hay fila para esta cancelación. **El fallo silencioso es el problema.**

**Segundo hallazgo colateral no menor:** al buscar `p01.jpg` bajo todos los poderes, encontré **9 cancelaciones distintas con exactamente el mismo tamaño 274 568 bytes** para su `p01.jpg`. Byte-idénticos entre trámites no es imposible pero es sospechoso — puede indicar que también son un placeholder (un fondo escaneado repetido) o un patrón de bug distinto. Pendiente confirmar si es coincidencia por escaneado de la misma plantilla del banco o un segundo bug de raíz.

### 4) ¿Qué ve Gemini?

**Los mismos JPGs, sin fallback a fuente nativa.** Evidencia: `supabase/functions/procesar-cancelacion/index.ts` líneas 2206-2224:

```ts
const poderPrefix = `${cancelacionId}/cancelaciones/soportes/poder`;
const { data: poderFiles } = await supabaseService.storage.from(BUCKET_OUTPUT).list(poderPrefix);
const poderPaths = poderFiles.filter(...jpe?g).sort().map(f => `${poderPrefix}/${f.name}`);
const poderUrls = await Promise.all(poderPaths.map(p => createSignedStorageUrl(supabaseService, p)));
// → extractPoderBancoDedicado(poderUrls, LOVABLE_API_KEY_RP)
```

Es el mismo listado que consume `verificar-con-claude`. **Si el JPG es placeholder de 12 KB, Gemini también lo ve blanco.** Que Gemini haya devuelto identidad completa "MARIA FERNANDA PINZON ALVARADO / 52310103" con esa entrada solo puede explicarse como alucinación pura (sin fuente que soporte esos valores) o como reciclaje de un contexto previo. Esto confirma la hipótesis original de la auditoría anterior: **Gemini fabrica en vez de fallar cuando la fuente está vacía.**

### 5) Viabilidad de un quality gate al origen

**Es viable y no es caro.** Ya existe la infraestructura (`pdfToImages.ts` tiene guardias, solo mal calibradas). Cuatro chequeos posibles, ordenados por costo/beneficio:

| # | Chequeo | Dónde | Costo | Detecta caso 748f3220 |
|---|---|---|---|---|
| A | Subir `HEALTHY_JPEG_BYTES` a ~30 KB para poderes (páginas reales scan quedan >100 KB) | `pdfToImages.ts:71` u opción por-doc | trivial (1 línea) | **Sí** (12 KB < 30 KB) |
| B | Rechazar si **todas** las páginas tienen ±1% mismo tamaño (placeholder replica) | nuevo, en `CancelacionNueva.tsx` post-render pre-upload | 5-10 líneas | **Sí** (28 páginas exactas 12192) |
| C | SHA-256 por página + rechazar si ≥60% son iguales entre sí | usa `pdfSha256.ts` que ya existe | 10-15 líneas | **Sí** (todas idénticas) |
| D | Server-side post-upload: edge trigger que valide antes de habilitar `procesar-cancelacion` | nuevo, más invasivo | mayor | **Sí**, pero tarde |

Recomendación técnica: combinar **A + B** (client-side, antes del upload, antes de cobrar créditos). Es el punto más barato del pipeline. Server-side (D) solo tiene sentido como red de seguridad si nos preocupa un cliente adversarial saltándose validación client-side, lo cual no aplica hoy (el `unlock_expediente` cobra 2 créditos, no un flujo con adversario).

## Recomendación operativa (no implementación)

Antes de invertir en Hito 2 (extender `verificar-con-claude`) tiene más sentido cerrar la fuente:

1. **Fix del origen (A+B):** endurece el gate en `pdfToImages.ts` para que 12 KB uniformes NO lleguen al bucket. Costo: ~30 min de código + tests. Elimina el 100% de casos como 748f3220 desde el momento del upload.
2. **Reproceso retroactivo:** para las cancelaciones ya afectadas (748f3220 y las 9 con p01 de 274 568 sospechoso), tocará re-subir el poder desde el usuario — el PDF original no existe.
3. **Después** decidir si Hito 2 sigue valiendo la pena: si el gate cierra el 90% de la alucinación por-fuente-vacía, el ROI de contrastar con Claude a $0.10/caso baja bastante.

## Detalles técnicos (referencia)

- `src/pages/CancelacionNueva.tsx` líneas 21-26, 50-73, 106-128 (upload + validación previa).
- `src/lib/pdfToImages.ts` líneas 25-100 (config + `isCanvasUniform`), 103-189 (loop principal).
- `supabase/functions/procesar-cancelacion/index.ts` líneas 2199-2260 (reprocess_poder), 2358 (escritura), 2563 (comentario convención bucket).
- `supabase/functions/verificar-con-claude/index.ts` líneas 213-236 (consume las mismas rutas).
- Guardias existentes (calibradas bajo): `MIN_JPEG_BYTES=1500`, `HEALTHY_JPEG_BYTES=8000`. Caso real observado: **12192 bytes uniformes** → pasa.
- Bucket `expediente-files` (privado), convención `<id>/cancelaciones/soportes/<kind>/pXX.jpg`, sin retención del PDF original.
- Cliente pdfjs-dist v5 con el bug de render histórico ya parcheado en firma, pero sin defensa contra "resolvió sin pintar" en casos borde (PDFs XFA, cifrados, corruptos).

## Qué NO se hizo en esta auditoría (por diseño)

- No se modificó ningún archivo ni migración.
- No se llamó a Gemini/Claude adicionales.
- No se descargó el JPG de 12 KB para inspección binaria (podría hacerse en un turno de build si querés confirmar visualmente que es blanco puro vs. degradado).
- No se buscó una edge/función server-side de conversión — se confirmó por búsqueda exhaustiva que no existe (`rg -n "pdfToImages|soportes/poder"` cubre todo).
