# Fix pdfjs-dist: pasar `wasmUrl` para decodificar CCITTFaxDecode/JBIG2

## Diagnóstico confirmado

- `pdfjs-dist@^5.7.284` instalado.
- `node_modules/pdfjs-dist/wasm/` existe con los assets esperados: `jbig2.wasm`, `openjpeg.wasm`, `qcms_bg.wasm`, `quickjs-eval.wasm` + sus `_nowasm_fallback.js` / `quickjs-eval.js`.
- La API tipada del `DocumentInitParameters` acepta `wasmUrl?: string` (verificado en `types/src/display/api.d.ts` líneas 92/97).
- Hoy `src/lib/pdfToImages.ts` solo configura `GlobalWorkerOptions.workerSrc` — nunca pasa `wasmUrl` a `getDocument`. Esa es exactamente la ruta de fallo del render silencioso a blanco en PDFs con imágenes bilevel (CCITTFaxDecode / JBIG2), que son el 100% del mercado notarial escaneado.

## Estrategia de bundling elegida

**Servir los `.wasm` desde `public/pdfjs-wasm/` + apuntar `wasmUrl` a `/pdfjs-wasm/` en runtime.**

Comparativa evaluada:

| Opción | Encaje con este proyecto |
|---|---|
| `?url` por archivo | Requeriría 4 imports y pdfjs internamente construye rutas por nombre → no funciona (necesita un directorio base, no URLs individuales). |
| `import.meta.glob('.../wasm/*', { as: 'url' })` | Funciona técnicamente pero fragiliza el hash de nombres y no da un prefijo estable. |
| `vite-plugin-static-copy` | Dependencia nueva solo para 4 archivos. Innecesaria. |
| **`public/pdfjs-wasm/` + copia en `postinstall`** | Vite ya sirve `public/` verbatim en dev y lo copia a `dist/` en build. `wasmUrl` queda como string constante `"/pdfjs-wasm/"`, sin lógica runtime. Es el patrón más simple y ya coincide con cómo `public/template_venta_hipoteca.docx` se sirve hoy. |

Los `.wasm` de `pdfjs-dist` se versionan con el paquete, así que se copian una vez en `postinstall` — no se commitean binarios en el repo.

## Cambios propuestos

### 1. `package.json` — script `postinstall`

Agregar un script que copie `node_modules/pdfjs-dist/wasm/` a `public/pdfjs-wasm/` tras cada `bun install`. Cross-platform con `node -e`:

```json
"scripts": {
  ...
  "postinstall": "node -e \"require('fs').cpSync('node_modules/pdfjs-dist/wasm','public/pdfjs-wasm',{recursive:true})\""
}
```

### 2. `.gitignore` — ignorar el directorio copiado

Agregar `public/pdfjs-wasm/` para no commitear los binarios (se regeneran en cada instalación / build).

### 3. `src/lib/pdfToImages.ts` — diff mínimo

Único cambio: pasar `wasmUrl` a `getDocument`. **No se toca** `isCanvasUniform`, `EmptyCanvasError`, `UniformDocumentError`, `HEALTHY_JPEG_BYTES`, `MIN_JPEG_BYTES`, `UNIFORM_DOC_*`, ni el bucle de render. El gate de calidad queda íntegro — sigue siendo la última línea de defensa por si algún otro decoder falla.

```diff
 pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

+/**
+ * URL base (con slash final) desde la que pdfjs descarga los módulos WASM
+ * de decoders bilevel (JBIG2, CCITTFaxDecode) y de color/JPEG2000. Sin esto,
+ * pdfjs 5.x falla silenciosamente al render de imágenes bilevel — el canvas
+ * queda 100% blanco (std=0). Muy común en escaneos notariales (RICOH → fax
+ * Group 4). Los .wasm se copian a public/pdfjs-wasm/ vía postinstall.
+ */
+const PDFJS_WASM_URL = "/pdfjs-wasm/";
+
 ...
   const buf = await file.arrayBuffer();
-  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
+  const loadingTask = pdfjs.getDocument({
+    data: new Uint8Array(buf),
+    wasmUrl: PDFJS_WASM_URL,
+  });
```

## Riesgos e incompatibilidades

1. **Worker vs. main thread.** El decode JBIG2/CCITT ocurre dentro del Web Worker de pdfjs, no en el hilo principal. `wasmUrl` se pasa por `DocumentInitParameters` y pdfjs lo propaga al worker por su handshake interno — es el mecanismo documentado, no requiere config adicional del worker.
2. **CORS / origen.** `/pdfjs-wasm/` es same-origin (servido por Vite en dev y por el hosting en prod). No hay `crossOriginIsolated` ni SharedArrayBuffer involucrados.
3. **MIME de `.wasm`.** Vite dev server y el hosting de Lovable ya sirven `.wasm` con `application/wasm`. Sin acción.
4. **Rutas no root.** Si algún día la app se sirve bajo un subpath (`/app/...`), `wasmUrl: "/pdfjs-wasm/"` seguiría funcionando porque `public/` se copia a la raíz del build; solo se rompería si Vite se configurara con `base` distinto de `/`. Hoy `vite.config.ts` no define `base`, así que no aplica.
5. **Tests (Vitest, jsdom).** `pdfToImages.test.ts` mockea `pdfjs-dist` entero — nunca ejecuta el getDocument real. Agregar `wasmUrl` no altera el mock. Los 203 tests seguirán en verde.
6. **Fallback JS puro.** Si por cualquier razón el `.wasm` no carga (404, MIME roto), pdfjs cae al `*_nowasm_fallback.js` — decodifica igual, más lento. No hay regresión de "silencioso a blanco".
7. **Regeneración en CI/despliegue.** El hosting de Lovable ejecuta `bun install`, disparando `postinstall` → `public/pdfjs-wasm/` existe antes del `vite build`. Confirmado mentalmente contra el pipeline estándar.

## Fuera de alcance

- No se toca el gate de calidad (`HEALTHY_JPEG_BYTES`, uniform detection, etc.).
- No se toca `maxDimension`, `jpegQuality`, ni `MAX_UPSCALE`.
- No hay migración de DB.
- No se re-procesan retroactivamente cancelaciones históricas que fueron rechazadas por este bug — decisión de producto separada.

## Validación post-implementación (para el turno de Build)

1. `ls public/pdfjs-wasm/jbig2.wasm` tras `bun install`.
2. `bunx vitest run` → seguir en 203/203.
3. Smoke manual: subir el poder de Escritura 16.390 (CCITT Group 4) — debe pasar el gate y OCR extraer texto legible.
