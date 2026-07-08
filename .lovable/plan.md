# Plan v2 (calibración corregida): PNG binarizado en `pdfToImages`

Cambio respecto a v1: **umbrales `HEALTHY_IMAGE_BYTES` y `MIN_IMAGE_BYTES` recalibrados con evidencia empírica real**, no asumidos. El resto del plan v1 se mantiene idéntico.

## Evidencia empírica (medida en este turno)

Canvas de 1836×2376 px (equivalente a `maxDimension=2600` sobre Carta), codificado como PNG en modo RGBA (que es lo que produce `HTMLCanvasElement.toBlob("image/png")` en el navegador — no PNG 1-bit indexed, que sería ~2 KB):

| Escenario | Bytes PNG reales |
|---|---|
| Blanco puro (placeholder canvas vacío) | **22,234** |
| Negro puro (placeholder canvas vacío) | **22,234** |
| Portada escueta: título grande + 3 líneas + firma | **28,646** |
| Página de firmas (5 renglones dispersos) | **33,062** |
| Página densa de texto (60 líneas Lorem-notarial) | **135,112** |
| Página densa real (dato owner, Escritura 16.390) | ~223,000 promedio |

Ventana entre placeholder blanco (22 KB) y sparse legítimo mínimo (28.6 KB) = solo **~6 KB de margen**.

## Umbrales corregidos

### `HEALTHY_IMAGE_BYTES = 40_000` (antes 8_000 en v1, 30_000 en JPEG)

Racionalidad:
- **Piso**: cualquier blob por debajo de este umbral **combinado con `isCanvasUniform=true`** dispara `EmptyCanvasError`. Debe estar cómodamente por encima del placeholder blanco/negro puro (22.2 KB) para atrapar el bug reincidente sin falsos positivos.
- **Techo**: debe estar por debajo del contenido legítimo mínimo esperado. Sparse portada real ≈ 28.6 KB, página de firmas ≈ 33 KB.
- **40,000 B** da:
  - Margen de +17.8 KB sobre placeholder blanco (80% headroom): atrapa con holgura al placeholder aunque futuras versiones de pdfjs lo hagan un poco distinto.
  - Combinado con la condición `isCanvasUniform` (≥80% de 25 muestras del mismo color), un sparse legítimo de 28–33 KB **no cae aquí porque no es uniforme** — su título + firma quiebran el muestreo. La conjunción `uniform && size < 40_000` sigue siendo específica del caso patológico.
  - Página densa (135–223 KB) queda claramente arriba.

### `MIN_IMAGE_BYTES = 5_000` (antes 800 en v1, 1_500 en JPEG)

Racionalidad:
- Este umbral es **independiente de `isCanvasUniform`**: aborta la página si el blob es tan pequeño que el stream está corrupto/truncado, sin necesidad de más señales.
- El piso absoluto físico observado es 22.2 KB (blanco puro RGBA a 2600 px). Cualquier salida <5 KB es imposible bajo funcionamiento normal — indica que `toBlob` devolvió un stream truncado o que el canvas quedó en dimensiones cero.
- **800 B (v1) era demasiado laxo**: quedaba órdenes de magnitud por debajo del mínimo físico y no aportaba señal útil. **5 KB** sigue siendo conservador (4.4× por debajo del blanco puro real) pero atrapa truncamiento real.
- No confundir con `HEALTHY_IMAGE_BYTES`: son propósitos distintos. `MIN` es "corrupto seguro"; `HEALTHY` es "placeholder blanco disfrazado".

### `UNIFORM_DOC_THRESHOLD = 0.9` y `UNIFORM_DOC_MIN_PAGES = 3`: se mantienen

PNG deflate es determinista bit-a-bit — dos páginas realmente distintas jamás producen el mismo tamaño exacto. Detector aún más confiable que en JPEG.

## Actualización de tests en `pdfToImages.test.ts`

Impacto por cada test (líneas aproximadas del archivo actual):

| Test (línea) | Cambio |
|---|---|
| `installCanvasMocks` (L64–86) | Blob type `"image/jpeg"` → `"image/png"` |
| L131 "uniform=true con blob sano (>=30 KB) NO lanza en 1a página" | Renombrar a `">=40 KB"`; `sizePerPage` default (40k + n*3k) sigue sirviendo, pero verificar que valores en la 1a página quedan `>= 40_000` — ajustar a `40_000 + n*5_000` para holgura. |
| L139 "uniform=true con blob pequeño (<30 KB) SÍ lanza EmptyCanvasError" | Renombrar a `"<40 KB"`; `sizePerPage: () => 20_000` sigue válido (20k < 40k) — sin cambios funcionales, solo actualizar título/comentario. |
| L147 "JPEG sospechosamente pequeño (1.5 KB)" | Renombrar a `"imagen sospechosamente pequeña (<5 KB)"`; `sizePerPage: () => 500` sigue < 5_000, válido. Actualizar regex `/sospechosamente pequeño/` → `/sospechosamente pequeña/`. |
| L156 "caso 12192 bytes reproducido" | 12,192 < 40,000 + `uniform=true` → sigue lanzando `EmptyCanvasError`. **Sin cambios** — el fingerprint histórico sigue atrapado, ahora con más margen. Actualizar solo el comentario para explicar los nuevos umbrales. |
| L172 "uniforme por encima del piso pero se repite en ≥90%" | `sizePerPage: () => 50_000` (uniforme + tamaño idéntico) — 50k > 40k así que **no cae por EmptyCanvasError individual**, pero sí por `UniformDocumentError` (90%+ mismo tamaño). Sigue válido, comportamiento preservado. |
| L184 "tamaños variados normales (real 20 páginas 158-282 KB)" | Los tamaños reales bajo PNG binarizado ≈ 200–300 KB, banda 158–282 KB sigue representativa. **Sin cambios.** |
| L198 "no aplica detector con <3 páginas" | Sin cambios. |
| Tests de calibración de DPI (L211+) | Sin cambios (validan dimensiones canvas, no formato). |

Ningún test necesita rehacerse conceptualmente; solo re-etiquetado y (en un caso) ajuste de `sizePerPage` para mantener holgura.

## Alcance sin cambios respecto a v1

- `src/lib/pdfToImages.ts`: binarización con `BINARIZATION_THRESHOLD = 180` (Rec. 601 luma), `toBlob("image/png")` sin `jpegQuality`, mantener firma pública con `jpegQuality` `@deprecated`.
- `src/pages/CancelacionNueva.tsx`: `.jpg`→`.png`, `contentType: "image/jpeg"`→`"image/png"`.
- `supabase/functions/_shared/pdfSha256.ts`: comentario `p01.jpg` → `p01.png`.
- Riesgos evaluados (sellos claros, fotos, Gemini PNG-vs-JPEG, memoria canvas, Safari, `ocr_raw_cache`): idénticos a v1, todos bajos/nulos.

## Diff propuesto (resumen numérico corregido)

```text
src/lib/pdfToImages.ts
- MIN_JPEG_BYTES = 1500                → MIN_IMAGE_BYTES = 5_000
- HEALTHY_JPEG_BYTES = 30_000          → HEALTHY_IMAGE_BYTES = 40_000
+ BINARIZATION_THRESHOLD = 180
+ function binarizeImageData(id, threshold)  // Rec. 601 luma → 0 o 255
  render loop:
+   ctx.putImageData(binarizeImageData(ctx.getImageData(...)), 0, 0)
-   canvas.toBlob(cb, "image/jpeg", jpegQuality)
+   canvas.toBlob(cb, "image/png")
  PdfToImagesOptions.jpegQuality: @deprecated (ignorado)
  Mensajes/JSDoc "JPEG" → "imagen"

src/lib/pdfToImages.test.ts
  Blob type "image/jpeg" → "image/png"
  Títulos "30 KB"/"1.5 KB" → "40 KB"/"5 KB"
  sizePerPage del test L131 elevado a 40k + n*5k para holgura

src/pages/CancelacionNueva.tsx
  ".jpg" → ".png";  "image/jpeg" → "image/png"

supabase/functions/_shared/pdfSha256.ts
  comentario "p01.jpg" → "p01.png"
```

## Validación post-implementación (sin cambios respecto a v1)

1. `bunx vitest run src/lib/pdfToImages.test.ts` → 12 tests en verde.
2. `bunx vitest run` → suite completa 203/203 verde.
3. Smoke manual Escritura 16.390: subidas `.png`/`image/png`, payload total <30 MB, OCR legible.
