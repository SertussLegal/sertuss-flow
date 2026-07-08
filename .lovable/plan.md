# Plan: PNG binarizado en `pdfToImages`

Migrar la codificación de páginas renderizadas de **JPEG q0.82** a **PNG 1-bit (binarizado por umbral)** manteniendo `maxDimension=2600` (~200 DPI). Objetivo: bajar 37.86 MB → ~6.26 MB en el PDF de referencia (Escritura 16.390, 28 pág.) sin sacrificar DPI, eliminando 413 del AI Gateway y mejorando bordes de texto pequeño.

## Alcance

3 archivos de código + 0 migraciones + 0 secretos.

1. `src/lib/pdfToImages.ts` — pipeline de codificación + umbrales.
2. `src/lib/pdfToImages.test.ts` — mocks + asserciones recalibradas.
3. `src/pages/CancelacionNueva.tsx` — extensión y `contentType` de subida.

`supabase/functions/_shared/pdfSha256.ts` solo tiene un comentario mencionando `.jpg`; se actualiza el comentario para reflejar `.png`. No hay cambios de comportamiento en edge functions: `runGemini`/`procesar-cancelacion` consumen **signed URLs** desde el bucket, y Gemini infiere el MIME de la URL/headers — no hay ruta de base64 activa que dependa de `image/jpeg` para las páginas del poder/cert/escritura (verificado con `rg`).

## Cambios detallados

### 1) `src/lib/pdfToImages.ts`

**a. Nueva constante `BINARIZATION_THRESHOLD = 180`**  
Umbral en escala 0–255 sobre luma. Valor validado empíricamente por el owner en el PDF real. Documentar como ajustable con comentario que explique: subir → más agresivo (pierde grises tenues, sellos claros); bajar → conserva grises pero infla PNG y puede introducir ruido de fondo.

**b. Función pura `binarizeImageData(imageData, threshold)`**  
Recorre `ImageData.data` en pasos de 4 (RGBA). Para cada píxel:
- `luma = 0.299*R + 0.587*G + 0.114*B` (Rec. 601).
- Si `luma >= threshold` → escribe `(255,255,255,255)`; si no → `(0,0,0,255)`.

Se aplica **in-place** sobre el `ImageData` obtenido con `ctx.getImageData(0,0,w,h)`, y luego `ctx.putImageData(...)` para que `toBlob` codifique ya binarizado. PNG con solo 2 colores + filtros PNG deflate → compresión altísima (validado ~223 KB/pág. denso).

**c. Cambiar `toBlob` a PNG**  
```ts
canvas.toBlob(cb, "image/png"); // sin quality param
```
Eliminar el argumento `jpegQuality` de la llamada. **Mantener la propiedad `jpegQuality` en `PdfToImagesOptions`** por compat de firma pública, marcarla `@deprecated` con JSDoc explicando que la ruta actual es PNG lossless y el parámetro se ignora. No romper callers.

**d. Renombrar semánticamente lo estrictamente necesario**  
- `MIN_JPEG_BYTES` → `MIN_IMAGE_BYTES` (mantener alias export si fuera público — no lo es, solo interno).
- `HEALTHY_JPEG_BYTES` → `HEALTHY_IMAGE_BYTES`.
- Actualizar mensajes de error de "JPEG" a "imagen".
- Actualizar comentario top-of-file y JSDoc.

**e. Recalibración de umbrales del gate de calidad**

Distribución esperada de PNG binarizado a 2600 px:
- Página densa de texto notarial: ~200–350 KB.
- Página escueta legítima (portada, firmas): ~30–120 KB.
- Página realmente en blanco / placeholder blanco puro: **<5 KB** (PNG con un solo color comprime a casi nada).
- Placeholder negro puro: también <5 KB.

Nuevos valores propuestos:
- `MIN_IMAGE_BYTES = 800` (antes 1500). PNG binarizado uniforme comprime muchísimo más que JPEG; bajar el piso evita falso positivo en portadas legítimas casi vacías, pero sigue atrapando el caso "0 bytes / stream vacío".
- `HEALTHY_IMAGE_BYTES = 8_000` (antes 30_000). Umbral bajo el cual, **combinado con muestreo uniforme**, se declara `EmptyCanvasError`. En PNG binarizado, cualquier página con contenido real de texto supera 30 KB con holgura; 8 KB deja margen para páginas escuetas legítimas.
- `UNIFORM_DOC_THRESHOLD = 0.9` **se mantiene**. La detección "≥90% páginas con tamaño idéntico exacto" sigue siendo una firma válida de placeholder — de hecho **más confiable** que en JPEG porque PNG deflate es determinista bit-a-bit para contenido idéntico (dos páginas realmente distintas jamás producen el mismo tamaño exacto).
- `UNIFORM_DOC_MIN_PAGES = 3` se mantiene.

**f. `isCanvasUniform` se mantiene tal cual.** Sigue muestreando 25 puntos con umbral 80% del mismo color. Con contenido ya binarizado, la métrica es todavía más limpia (solo hay 2 valores posibles).

**g. `wasmUrl` / `MAX_UPSCALE` / `maxDimension` / render loop / cleanup / `PdfPageRenderError` / `EmptyCanvasError` / `UniformDocumentError`: sin cambios.**

### 2) `src/lib/pdfToImages.test.ts`

Los mocks de `HTMLCanvasElement.prototype.toBlob` producen blobs de tamaño arbitrario que no dependen del formato real. Cambios mínimos:

- `installCanvasMocks`: cambiar `type: "image/jpeg"` → `"image/png"` en el `new Blob(...)`.
- Test **"uniform=true con blob sano (>=30 KB)"**: renombrar a `">=8 KB"` y bajar `sizePerPage` acorde (no romper el propósito: blob por encima del umbral sano no debe lanzar aunque muestreo sea uniforme).
- Test **"uniform=true con blob pequeño (<30 KB)"** → `"<8 KB"`, cambiar `sizePerPage: () => 20_000` a algo < 8000, p. ej. `5_000`.
- Test **"JPEG sospechosamente pequeño (1.5 KB)"** → `"imagen sospechosamente pequeña (<800 B)"`, cambiar `sizePerPage: () => 500` a `() => 400` y ajustar regex `/sospechosamente/`.
- Test **"caso 12192 bytes"**: 12192 seguirá cayendo por el nuevo `HEALTHY_IMAGE_BYTES=8000`? No — **12192 > 8000, ya no caería por EmptyCanvasError individual**. Reajustar el mock para reproducir el fingerprint del incidente **bajo la nueva escala**: `sizePerPage: () => 3_000` (uniforme + <8 KB → `EmptyCanvasError`). Documentar en el comentario del test que 12192 era el fingerprint bajo JPEG; el equivalente bajo PNG binarizado sería <8 KB.
- Test **"uniforme por encima del piso pero se repite en ≥90%"**: se mantiene (mock a 50_000 bytes uniforme entre páginas → `UniformDocumentError`). Válido tal cual.
- Test **"tamaños variados normales (real 20 páginas 158-282 KB)"**: los tamaños reales bajo PNG binarizado observados por el owner son ~223 KB promedio — la banda 158–282 KB es representativa también. Se mantiene.
- Tests de **calibración de DPI** (Carta / Oficio / PDF pequeño): validan dimensiones del canvas, no formato. **Sin cambios.**
- Test **"no aplica detector con <3 páginas"**: sin cambios.

### 3) `src/pages/CancelacionNueva.tsx` (líneas 64 y 66)

```ts
const path = `${basePath}/p${String(p.pageNumber).padStart(2, "0")}.png`;
const { error } = await supabase.storage.from(BUCKET_OUTPUT).upload(path, p.blob, {
  contentType: "image/png",
  upsert: true,
});
```

Es el único caller de `pdfToImages` en la app (verificado con `rg`). No hay que tocar otros lugares del código de subida.

### 4) `supabase/functions/_shared/pdfSha256.ts` (comentario)

Actualizar comentario en línea 31: `(p01.jpg, p02.jpg, ...)` → `(p01.png, p02.png, ...)`. Solo docstring, no afecta el hash (el hash es sobre el binario del PDF crudo, no las páginas).

## Diff propuesto (resumido)

```text
src/lib/pdfToImages.ts
- MIN_JPEG_BYTES = 1500                → MIN_IMAGE_BYTES = 800
- HEALTHY_JPEG_BYTES = 30_000          → HEALTHY_IMAGE_BYTES = 8_000
+ BINARIZATION_THRESHOLD = 180
+ function binarizeImageData(id, threshold)
  render loop:
+   const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
+   binarizeImageData(id, BINARIZATION_THRESHOLD);
+   ctx.putImageData(id, 0, 0);
-   canvas.toBlob(cb, "image/jpeg", jpegQuality)
+   canvas.toBlob(cb, "image/png")
  PdfToImagesOptions.jpegQuality: @deprecated (ignorado)
  Mensajes/JSDoc "JPEG" → "imagen"

src/lib/pdfToImages.test.ts
  Blob type "image/jpeg" → "image/png"
  sizePerPage recalibrados a la nueva escala PNG binarizado
  Tests de DPI/uniform-document intactos en propósito

src/pages/CancelacionNueva.tsx
  ".jpg"        → ".png"
  "image/jpeg"  → "image/png"

supabase/functions/_shared/pdfSha256.ts
  comentario "p01.jpg" → "p01.png"
```

## Riesgos y mitigaciones

1. **Pérdida de sellos claros / marcas de agua tenues.** Threshold=180 elimina píxeles con luma ≥180 (grises muy claros). Sellos rojos, azules oscuros y firmas negras: OK. Marcas de agua muy tenues: se pierden. Ningún consumidor actual (`crossCheck.ts`, `poderBancoValidate.ts`, prosaBancos) usa color/gris — todo es OCR de texto, que es exactamente lo que la binarización refuerza. **Riesgo bajo.**
2. **PDFs con imágenes fotográficas legítimas** (ej. foto de cédula anexa). Binarización destruye tonos medios. Casos reales en cancelaciones Davivienda: los soportes son escaneos bitonales de fábrica; el poder/cert/escritura son texto notarial. **Riesgo bajo pero real** — si aparece un caso, se puede introducir un modo `preserveGrayscale?: boolean` sin romper la ruta actual.
3. **Gemini con PNG vs JPEG.** Gemini 2.5 Flash soporta PNG oficialmente (documentado por Google) al mismo nivel que JPEG. No hay preferencia conocida por JPEG. **Riesgo nulo.**
4. **Tamaño del canvas grande + `getImageData`.** A 2600 px lado mayor un canvas ~2000×2600 = 5.2 M píxeles × 4 bytes = 20.8 MB en RAM por página, transitorio. Ya vivíamos con eso (pdfjs pintaba lo mismo). El paso extra es un bucle O(N) sobre esos 20 MB — coste marginal (<50 ms/página en dispositivos típicos). **Riesgo nulo.**
5. **HTMLCanvasElement.toBlob("image/png") en Safari.** Soporte universal desde hace años. **Riesgo nulo.**
6. **Cache `ocr_raw_cache` por `sha256Hex(PDF crudo)`.** El hash es sobre el PDF binario, no las páginas. Cambiar el formato de salida **no invalida** entradas cacheadas: si un PDF ya se procesó, se sigue reutilizando su resultado OCR. Los PDFs nuevos usarán PNG. Consistente.

## Validación post-implementación

1. `bunx vitest run src/lib/pdfToImages.test.ts` → 12 tests en verde con los mocks actualizados.
2. `bunx vitest run` → suite completa 203/203 en verde (los otros no tocan este módulo).
3. Smoke manual con Escritura 16.390 en preview: cargar cert + escritura + poder, confirmar que:
   - Los blobs subidos al bucket son `.png` con `contentType: image/png`.
   - El total del payload que Gemini descarga cae por debajo de 30 MB (no más 413).
   - El OCR produce texto legible (comparar campos extraídos vs. corridas anteriores en JPEG cuando el gate no rechazaba).
