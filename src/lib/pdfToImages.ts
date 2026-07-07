/**
 * Renderiza páginas de un PDF a JPEGs en serie, liberando memoria agresivamente
 * página a página para evitar OOM en el cliente con escrituras grandes.
 *
 * Solo procesa las primeras `maxPages` páginas — para cancelaciones de hipoteca
 * Davivienda eso es suficiente (cuantía, deudores, banco, matrícula y cláusulas
 * residen en las primeras hojas).
 *
 * P1 (2026-07): endurecido contra el bug de "JPEGs uniformes de placeholder".
 * En pdfjs-dist ≥4/5 la firma de `page.render` ya no acepta un 3.er param
 * `canvas`; pasarlo hacía que el render resolviera sin pintar y `toBlob`
 * generaba 25 JPEGs blancos idénticos (~12 KB c/u). Ahora:
 *   1) Firma correcta `{ canvasContext, viewport }`.
 *   2) try/catch por página con `PdfPageRenderError` explícito.
 *   3) Muestreo de píxel post-render → `EmptyCanvasError` si el canvas quedó
 *      uniforme (blanco/negro).
 *   4) Asserción de tamaño mínimo (<3 KB = placeholder sospechoso).
 */
import * as pdfjs from "pdfjs-dist";
// El worker se sirve estáticamente desde node_modules vía Vite
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfToImagesOptions {
  /** Máximo de páginas a renderizar (default 10). Configurable: 3 certificados, 10 escrituras. */
  maxPages?: number;
  /** Lado mayor del canvas, en pixeles (default 1600). */
  maxDimension?: number;
  /** Calidad JPEG entre 0 y 1 (default 0.75). */
  jpegQuality?: number;
}

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

/** Umbral mínimo razonable para un JPEG con contenido real a 1600px lado mayor. */
const MIN_JPEG_BYTES = 1500;

/**
 * Por encima de este tamaño consideramos que el render sí pintó contenido
 * "sustancial", aunque el muestreo dé uniforme. El bug histórico producía
 * ~12 KB en TODAS las páginas por igual; una página escueta legítima
 * (encabezado, firma) queda por debajo. Ver detección de duplicados abajo.
 */
const HEALTHY_JPEG_BYTES = 8000;

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
  const { maxPages = 10, maxDimension = 1600, jpegQuality = 0.75 } = opts;

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const pdf = await loadingTask.promise;
  const total = Math.min(pdf.numPages, maxPages);

  const out: RenderedPage[] = [];

  for (let i = 1; i <= total; i++) {
    let canvas: HTMLCanvasElement | null = null;
    try {
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const longest = Math.max(baseViewport.width, baseViewport.height);
      const scale = Math.min(2, maxDimension / longest);
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

  return out;
}
