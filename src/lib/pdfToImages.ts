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
const MIN_JPEG_BYTES = 3000;

/**
 * Muestrea 5 puntos del canvas y devuelve `true` si todos los píxeles son
 * idénticos (canvas uniforme = placeholder sospechoso).
 */
function isCanvasUniform(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const pts: Array<[number, number]> = [
    [Math.floor(w / 2), Math.floor(h / 2)],
    [Math.floor(w / 4), Math.floor(h / 4)],
    [Math.floor((3 * w) / 4), Math.floor(h / 4)],
    [Math.floor(w / 4), Math.floor((3 * h) / 4)],
    [Math.floor((3 * w) / 4), Math.floor((3 * h) / 4)],
  ];
  let ref: string | null = null;
  for (const [x, y] of pts) {
    try {
      const d = ctx.getImageData(x, y, 1, 1).data;
      const key = `${d[0]},${d[1]},${d[2]}`;
      if (ref === null) ref = key;
      else if (key !== ref) return false;
    } catch {
      // Si no podemos leer, asumimos no-uniforme (no bloqueamos por eso).
      return false;
    }
  }
  return true;
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

      // Firma correcta para pdfjs-dist ≥4/5: sin `canvas` como 3.er param.
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Validación forense: si el canvas quedó uniforme, el render abortó
      // silenciosamente. No dejamos que llegue a Storage como placeholder.
      if (isCanvasUniform(ctx, canvas.width, canvas.height)) {
        throw new EmptyCanvasError(i);
      }

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
