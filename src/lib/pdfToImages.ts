/**
 * Renderiza páginas de un PDF a imágenes PNG binarizadas (blanco/negro puro)
 * en serie, liberando memoria agresivamente página a página para evitar OOM
 * en el cliente con escrituras grandes.
 *
 * Solo procesa las primeras `maxPages` páginas — para cancelaciones de hipoteca
 * Davivienda eso es suficiente (cuantía, deudores, banco, matrícula y cláusulas
 * residen en las primeras hojas).
 *
 * 2026-07 — Migración JPEG → PNG binarizado:
 * Los escaneos notariales colombianos vienen de fotocopiadoras CCITT Group 4
 * (bitonal de fábrica). Codificarlos como JPEG q0.82 pesaba ~1.35 MB/pág.
 * (37.86 MB en 28 páginas → 413 en AI Gateway, límite 30 MB). Binarizar por
 * umbral de luma (Rec. 601) + PNG deflate reduce el mismo documento a
 * ~223 KB/pág. (~6.3 MB total) manteniendo maxDimension=2600 (~200 DPI), con
 * bordes de glifos más nítidos (sin ringing JPEG). Validado empíricamente
 * sobre Escritura 16.390 (28 páginas).
 *
 * P1 (2026-07): endurecido contra el bug de "imágenes uniformes de placeholder".
 * En pdfjs-dist ≥4/5 la firma de `page.render` ya no acepta un 3.er param
 * `canvas`; pasarlo hacía que el render resolviera sin pintar y `toBlob`
 * generaba imágenes blancas idénticas (~12 KB c/u). Ahora:
 *   1) Firma correcta `{ canvasContext, viewport }`.
 *   2) try/catch por página con `PdfPageRenderError` explícito.
 *   3) Muestreo de píxel post-render → `EmptyCanvasError` si el canvas quedó
 *      uniforme (blanco/negro) Y el blob es sospechosamente pequeño.
 *   4) Asserción de tamaño mínimo absoluto (placeholder sospechoso).
 */
import * as pdfjs from "pdfjs-dist";
// El worker se sirve estáticamente desde node_modules vía Vite
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

/**
 * URL base (con slash final) desde la que pdfjs descarga los módulos WASM
 * de decoders bilevel (JBIG2, CCITTFaxDecode) y de color/JPEG2000. Sin esto,
 * pdfjs 5.x falla silenciosamente al render de imágenes bilevel — el canvas
 * queda 100% blanco (std=0). Muy común en escaneos notariales (RICOH → fax
 * Group 4). Los .wasm se copian a public/pdfjs-wasm/ vía postinstall.
 */
const PDFJS_WASM_URL = "/pdfjs-wasm/";

export interface PdfToImagesOptions {
  /** Máximo de páginas a renderizar (default 10). Configurable: 3 certificados, 10 escrituras. */
  maxPages?: number;
  /**
   * Lado mayor del canvas, en pixeles (default 2600).
   * Calibrado para ~200 DPI efectivo sobre Oficio colombiano (612×936 pt):
   *   936 pt × (200/72) = 2600 px. Carta (792 pt) queda en 2200 px (200 DPI),
   *   A4 (842 pt) queda en 2339 px (200 DPI). 200 DPI es el piso estándar
   *   para OCR fiable de texto legal pequeño (cédulas, escrituras, firmas).
   */
  maxDimension?: number;
  /**
   * @deprecated 2026-07 — La ruta activa codifica PNG lossless binarizado
   * (blanco/negro puro) y ya no acepta parámetro de calidad. Se mantiene en
   * la firma pública para no romper callers; su valor se ignora.
   */
  jpegQuality?: number;
}

/**
 * Tope de upscaling. Un PDF originalmente pequeño (p. ej. digital de 400 pt de
 * lado mayor) se sube hasta 3× para alcanzar el objetivo de 200 DPI en vez de
 * quedarse pixelado. 3× = 200/72 × margen (2.78 real).
 */
const MAX_UPSCALE = 3;


export interface RenderedPage {
  pageNumber: number;
  blob: Blob;
  /** Tamaño aproximado del JPEG en bytes. */
  size: number;
}

export class PdfPageRenderError extends Error {
  constructor(public pageNumber: number, public cause?: unknown) {
    super(
      `Página ${pageNumber} no se pudo renderizar${
        cause instanceof Error ? `: ${cause.message}` : ""
      }`,
    );
    this.name = "PdfPageRenderError";
  }
}

export class EmptyCanvasError extends Error {
  constructor(public pageNumber: number) {
    super(
      `Página ${pageNumber}: el render devolvió un canvas vacío/uniforme (placeholder). ` +
        `Suele ser incompatibilidad con la versión de pdfjs-dist o falta de memoria del navegador.`,
    );
    this.name = "EmptyCanvasError";
  }
}

/**
 * Se lanza cuando el documento completo huele a placeholder: todas (o casi
 * todas) las páginas producen JPEGs de tamaño idéntico. Es el fingerprint
 * exacto del incidente 748f3220 (28 páginas × 12192 bytes) y de los 3
 * casos históricos (0443d2f1, 0e80553d, 4b05d210). Un poder real de 20+
 * páginas tiene siempre variación de tamaño ≥ ±10% entre páginas.
 */
export class UniformDocumentError extends Error {
  constructor(
    public totalPages: number,
    public duplicatedPages: number,
    public sampleSize: number,
  ) {
    super(
      `Documento sospechoso: ${duplicatedPages}/${totalPages} páginas comparten el mismo ` +
        `tamaño exacto (~${sampleSize} bytes). Probable render fallido/placeholder. ` +
        `Vuelve a intentar la carga o usa un escáner distinto.`,
    );
    this.name = "UniformDocumentError";
  }
}

/** Piso absoluto por página. Cualquier JPEG por debajo es basura garantizada. */
const MIN_JPEG_BYTES = 1500;

/**
 * Umbral "sano" por página al `maxDimension` por defecto (2600 px).
 * Datos reales observados en producción (auditoría 2026-07, entonces a 1600 px):
 *   - Poderes/escrituras legítimas: 158 KB – 358 KB por página.
 *   - Placeholder bug: 12192 bytes exactos en todas las páginas.
 * A 2600 px + q0.82 los tamaños suben aún más (400 KB – 950 KB densos), por
 * lo que 30000 bytes sigue siendo un piso conservador que atrapa el caso
 * 12192 con >2× de margen sin generar falsos positivos contra páginas
 * legítimamente ligeras.
 */
const HEALTHY_JPEG_BYTES = 30_000;


/**
 * Umbral para "documento uniforme": si ≥90% de páginas tienen el mismo tamaño
 * EXACTO en bytes, es placeholder. Un PDF real jamás produce esto — hasta
 * dos páginas visualmente casi idénticas difieren por metadatos JPEG.
 * Solo se aplica si el documento tiene ≥3 páginas (con 1-2 páginas la
 * coincidencia no es señal).
 */
const UNIFORM_DOC_MIN_PAGES = 3;
const UNIFORM_DOC_THRESHOLD = 0.9;


/**
 * Muestrea una grilla de 5x5 (25 puntos). Devuelve `true` si ≥80% comparten
 * el mismo color (canvas uniforme sospechoso). Antes usábamos 5 puntos con
 * exigencia de idénticos entre sí, lo que daba falsos positivos en páginas
 * con márgenes amplios o poco contenido: los 5 caían en blanco y abortábamos
 * un render válido. La grilla amplia con umbral 80% tolera páginas escuetas.
 */
function isCanvasUniform(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const gridN = 5;
  const counts = new Map<string, number>();
  let sampled = 0;
  for (let i = 1; i <= gridN; i++) {
    for (let j = 1; j <= gridN; j++) {
      const x = Math.floor((w * i) / (gridN + 1));
      const y = Math.floor((h * j) / (gridN + 1));
      try {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const key = `${d[0]},${d[1]},${d[2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        sampled++;
      } catch {
        return false;
      }
    }
  }
  if (sampled === 0) return false;
  const maxSame = Math.max(...counts.values());
  return maxSame / sampled >= 0.8;
}

export async function pdfToImages(
  file: File,
  opts: PdfToImagesOptions = {},
): Promise<RenderedPage[]> {
  const { maxPages = 10, maxDimension = 2600, jpegQuality = 0.82 } = opts;

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    wasmUrl: PDFJS_WASM_URL,
  });
  const pdf = await loadingTask.promise;
  const total = Math.min(pdf.numPages, maxPages);

  const out: RenderedPage[] = [];

  for (let i = 1; i <= total; i++) {
    let canvas: HTMLCanvasElement | null = null;
    try {
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const longest = Math.max(baseViewport.width, baseViewport.height);
      const scale = Math.min(MAX_UPSCALE, maxDimension / longest);
      const viewport = page.getViewport({ scale });


      canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("No se pudo crear contexto 2D");

      // pdfjs-dist v5 exige `canvas` en RenderParameters (los tipos lo marcan
      // como required). La hipótesis previa de "quitar canvas" es incorrecta
      // para esta versión; el bug de "placeholders uniformes" se ataca abajo
      // con muestreo forense + asserción de tamaño mínimo.
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      const uniform = isCanvasUniform(ctx, canvas.width, canvas.height);

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas!.toBlob(
          (b) => (b ? resolve(b) : reject(new Error(`Página ${i}: toBlob falló`))),
          "image/jpeg",
          jpegQuality,
        );
      });

      if (blob.size < MIN_JPEG_BYTES) {
        throw new Error(
          `Página ${i}: JPEG sospechosamente pequeño (${blob.size} bytes < ${MIN_JPEG_BYTES}). ` +
            `Probable placeholder blanco.`,
        );
      }

      // Solo abortamos por uniforme si además el JPEG es liviano. El bug
      // histórico de placeholders producía canvases uniformes Y pequeños
      // simultáneamente. Una página escueta pero legítima (poco contenido,
      // márgenes amplios) genera JPEG por encima de HEALTHY_JPEG_BYTES y
      // debe pasar aunque el muestreo la marque como "uniforme".
      if (uniform && blob.size < HEALTHY_JPEG_BYTES) {
        throw new EmptyCanvasError(i);
      }
      if (uniform) {
        console.warn(
          `[pdfToImages] Página ${i}: muestreo uniforme pero blob de ${blob.size} bytes ` +
            `(≥ ${HEALTHY_JPEG_BYTES}); se acepta como página escueta legítima.`,
        );
      }


      out.push({ pageNumber: i, blob, size: blob.size });

      // Liberación agresiva
      page.cleanup();
    } catch (err) {
      if (err instanceof EmptyCanvasError || err instanceof PdfPageRenderError) throw err;
      throw new PdfPageRenderError(i, err);
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
  }

  await pdf.cleanup();
  await pdf.destroy();

  // Detección de "documento uniforme": placeholder de todas las páginas.
  // Agrupa por tamaño EXACTO; si ≥90% caen en el mismo tamaño y hay ≥3
  // páginas, aborta el upload completo. Log ruidoso a consola con toda la
  // información forense para poder correlacionar en Sentry/activity_logs.
  if (out.length >= UNIFORM_DOC_MIN_PAGES) {
    const bySize = new Map<number, number>();
    for (const p of out) bySize.set(p.size, (bySize.get(p.size) ?? 0) + 1);
    let topSize = 0;
    let topCount = 0;
    for (const [s, c] of bySize) {
      if (c > topCount) {
        topCount = c;
        topSize = s;
      }
    }
    const ratio = topCount / out.length;
    if (ratio >= UNIFORM_DOC_THRESHOLD) {
      console.error(
        `[pdfToImages] DOCUMENTO UNIFORME rechazado: ${topCount}/${out.length} ` +
          `páginas con tamaño idéntico (${topSize} bytes). Fingerprint sizes=`,
        out.map((p) => p.size),
      );
      throw new UniformDocumentError(out.length, topCount, topSize);
    }
  }

  return out;
}

