/**
 * Renderiza páginas de un PDF a JPEGs en serie, liberando memoria agresivamente
 * página a página para evitar OOM en el cliente con escrituras grandes.
 *
 * Solo procesa las primeras `maxPages` páginas — para cancelaciones de hipoteca
 * Davivienda eso es suficiente (cuantía, deudores, banco, matrícula y cláusulas
 * residen en las primeras hojas).
 */
import * as pdfjs from "pdfjs-dist";
// El worker se sirve estáticamente desde node_modules vía Vite
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfToImagesOptions {
  /** Máximo de páginas a renderizar (default 10). */
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
    const page = await pdf.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const longest = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(2, maxDimension / longest);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      throw new Error("No se pudo crear contexto 2D");
    }

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error(`Página ${i}: toBlob falló`))),
        "image/jpeg",
        jpegQuality,
      );
    });

    out.push({ pageNumber: i, blob, size: blob.size });

    // Liberación agresiva de memoria
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }

  await pdf.cleanup();
  await pdf.destroy();

  return out;
}
