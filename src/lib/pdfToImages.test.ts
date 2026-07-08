/**
 * P1 — Test B del plan: garantiza que `pdfToImages` produce JPEGs
 * *diferentes* por página, no placeholders uniformes.
 *
 * Estrategia: no rasterizamos un PDF real en jsdom (no hay canvas 2D real
 * ni Web Worker). En su lugar:
 *   1) Mockeamos `pdfjs-dist` para simular getDocument/getPage/render.
 *   2) Mockeamos `HTMLCanvasElement.getContext` y `toBlob` para devolver
 *      píxeles distintos por página (el render "pinta" un color que
 *      depende del número de página) y blobs de tamaño distinto.
 *   3) Confirmamos:
 *      - Se generan N blobs.
 *      - Los tamaños difieren >5% entre páginas.
 *      - Un render que devuelve canvas uniforme lanza `EmptyCanvasError`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock de pdfjs-dist ─────────────────────────────────────────────────
vi.mock("pdfjs-dist", () => {
  const makePage = (n: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 800 * scale,
      height: 1000 * scale,
    }),
    render: () => ({
      promise: (async () => {
        // Emula "pintar" cambiando el color de fondo del canvas actual.
        // El test controla qué píxeles devolvería getImageData vía __setPagePixel.
        (globalThis as any).__lastRenderedPage = n;
      })(),
    }),
    cleanup: () => {},
  });

  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: (_: unknown) => ({
      promise: Promise.resolve({
        numPages: (globalThis as any).__mockNumPages ?? 3,
        getPage: async (n: number) => makePage(n),
        cleanup: async () => {},
        destroy: async () => {},
      }),
    }),
  };
});

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "" }));

// ── Instalación de mocks sobre HTMLCanvasElement ───────────────────────
function installCanvasMocks(opts: {
  uniform?: boolean;
  sizePerPage?: (n: number) => number;
}) {
  const sizePerPage = opts.sizePerPage ?? ((n: number) => 40_000 + n * 3_000);

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    _type: string,
  ) {
    return {
      // Píxel: uniforme=todo negro; no-uniforme=varía con el punto Y+página.
      getImageData: (x: number, y: number) => {
        const n = (globalThis as any).__lastRenderedPage ?? 1;
        const val = opts.uniform ? 0 : (x + y + n * 17) % 255;
        return { data: new Uint8ClampedArray([val, val, val, 255]) };
      },
    } as unknown as CanvasRenderingContext2D;
  });

  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    const n = (globalThis as any).__lastRenderedPage ?? 1;
    const bytes = new Uint8Array(sizePerPage(n));
    cb(new Blob([bytes], { type: "image/jpeg" }));
  });
}

function makeFile(): File {
  // jsdom no implementa Blob.arrayBuffer; parcheamos en el prototipo una vez.
  if (!(Blob.prototype as any).arrayBuffer) {
    (Blob.prototype as any).arrayBuffer = async function () {
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
    };
  }
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "poder.pdf", {
    type: "application/pdf",
  });
}

describe("pdfToImages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).__mockNumPages = 3;
    (globalThis as any).__lastRenderedPage = 0;
  });

  it("produce un blob por página con tamaños dispares (>5% variación pico-valle)", async () => {
    installCanvasMocks({});
    const { pdfToImages } = await import("./pdfToImages");
    const pages = await pdfToImages(makeFile(), { maxPages: 3 });

    expect(pages).toHaveLength(3);
    const sizes = pages.map((p) => p.size);
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);
    const spread = (max - min) / min;
    expect(spread).toBeGreaterThan(0.05);
  });

  it("respeta maxPages (no renderiza más de lo pedido)", async () => {
    installCanvasMocks({});
    (globalThis as any).__mockNumPages = 10;
    const { pdfToImages } = await import("./pdfToImages");
    const pages = await pdfToImages(makeFile(), { maxPages: 4 });
    expect(pages).toHaveLength(4);
  });

  it("uniform=true con blob sano (>=8 KB) NO lanza — página escueta legítima", async () => {
    // Default sizePerPage = 20_000 + n*3_000 → siempre >= HEALTHY_JPEG_BYTES.
    installCanvasMocks({ uniform: true });
    const { pdfToImages } = await import("./pdfToImages");
    const pages = await pdfToImages(makeFile(), { maxPages: 1 });
    expect(pages).toHaveLength(1);
  });

  it("uniform=true con blob pequeño (<8 KB) SÍ lanza EmptyCanvasError", async () => {
    installCanvasMocks({ uniform: true, sizePerPage: () => 4_000 });
    const { pdfToImages, EmptyCanvasError } = await import("./pdfToImages");
    await expect(pdfToImages(makeFile(), { maxPages: 1 })).rejects.toBeInstanceOf(
      EmptyCanvasError,
    );
  });

  it("lanza error explícito si el JPEG sale por debajo del umbral mínimo (1.5 KB)", async () => {
    installCanvasMocks({ sizePerPage: () => 500 });
    const { pdfToImages } = await import("./pdfToImages");
    await expect(pdfToImages(makeFile(), { maxPages: 1 })).rejects.toThrow(
      /sospechosamente pequeño/,
    );
  });
});
