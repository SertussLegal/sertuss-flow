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
// El baseViewport (scale=1) se lee de __basePt para poder simular tamaños
// reales de página (Carta 612×792, Oficio 612×936, etc.) en los tests de
// calibración de DPI. Default 800×1000 para no romper tests preexistentes.
vi.mock("pdfjs-dist", () => {
  const makePage = (n: number) => ({
    getViewport: ({ scale }: { scale: number }) => {
      const base = (globalThis as any).__basePt ?? { w: 800, h: 1000 };
      return { width: base.w * scale, height: base.h * scale };
    },
    render: () => ({
      promise: (async () => {
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
      // Nota: la implementación real llama getImageData(0,0,w,h) para
      // binarizar y también (x,y,1,1) desde isCanvasUniform; el mock ignora
      // ancho/alto y devuelve siempre un único píxel — suficiente porque
      // binarizeImageData recorre `data` por longitud, y aquí longitud=4.
      getImageData: (x: number, y: number) => {
        const n = (globalThis as any).__lastRenderedPage ?? 1;
        const val = opts.uniform ? 0 : (x + y + n * 17) % 255;
        return { data: new Uint8ClampedArray([val, val, val, 255]) };
      },
      // No-op: la binarización in-place es lo único que llama putImageData
      // en producción; el mock no necesita persistir píxeles.
      putImageData: () => {},
    } as unknown as CanvasRenderingContext2D;
  });

  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    const n = (globalThis as any).__lastRenderedPage ?? 1;
    // Capturamos las dimensiones reales del canvas por página para permitir
    // aserciones sobre la resolución efectiva (DPI) en los tests.
    const dims = ((globalThis as any).__canvasDims ??= [] as Array<{ w: number; h: number }>);
    dims.push({ w: this.width, h: this.height });
    const bytes = new Uint8Array(sizePerPage(n));
    cb(new Blob([bytes], { type: "image/png" }));
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
    (globalThis as any).__basePt = { w: 800, h: 1000 };
    (globalThis as any).__canvasDims = [];
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

  it("uniform=true con blob sano (>=30 KB) NO lanza en la 1a página escueta", async () => {
    // Solo 1 página → no aplica el detector de documento uniforme.
    installCanvasMocks({ uniform: true });
    (globalThis as any).__mockNumPages = 1;
    const { pdfToImages } = await import("./pdfToImages");
    const pages = await pdfToImages(makeFile(), { maxPages: 1 });
    expect(pages).toHaveLength(1);
  });

  it("uniform=true con blob pequeño (<30 KB) SÍ lanza EmptyCanvasError", async () => {
    installCanvasMocks({ uniform: true, sizePerPage: () => 20_000 });
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

  // ── Detector de "documento uniforme" (P1 — gate de calidad) ────────────

  it("rechaza documento con TODAS las páginas del mismo tamaño exacto (caso 12192 bytes reproducido)", async () => {
    // Fingerprint exacto del incidente 748f3220: N páginas × 12192 bytes.
    // 12192 > MIN_JPEG_BYTES (1500) → no cae por el piso absoluto.
    // 12192 < HEALTHY_JPEG_BYTES (30000) + canvas uniforme → cae ANTES por
    // EmptyCanvasError en la 1a página. Ese comportamiento es correcto y
    // suficiente: nunca se llega a subir un solo JPEG placeholder.
    installCanvasMocks({ uniform: true, sizePerPage: () => 12_192 });
    (globalThis as any).__mockNumPages = 28;
    const { pdfToImages, EmptyCanvasError } = await import("./pdfToImages");
    await expect(pdfToImages(makeFile(), { maxPages: 28 })).rejects.toBeInstanceOf(
      EmptyCanvasError,
    );
  });

  it("rechaza documento uniforme donde el tamaño está por encima del piso individual pero se repite en ≥90% de páginas", async () => {
    // Escenario adversarial: un futuro bug de render produce placeholders
    // "gordos" (>30 KB) pero idénticos entre sí. El detector individual
    // (uniform+small) no los atrapa; el detector de documento sí.
    installCanvasMocks({ uniform: false, sizePerPage: () => 50_000 });
    (globalThis as any).__mockNumPages = 10;
    const { pdfToImages, UniformDocumentError } = await import("./pdfToImages");
    await expect(pdfToImages(makeFile(), { maxPages: 10 })).rejects.toBeInstanceOf(
      UniformDocumentError,
    );
  });

  it("acepta documento con tamaños variados normales (caso real 20 páginas 158-282 KB)", async () => {
    // Sizes reales observados en producción para el poder de Maya Montoya.
    const realSizes = [
      274568, 261839, 282180, 263855, 274219, 268162, 272661, 265700,
      267373, 249491, 235624, 252790, 278806, 258872, 263750, 254338,
      271087, 249323, 253624, 158867,
    ];
    installCanvasMocks({ sizePerPage: (n) => realSizes[n - 1] ?? 200_000 });
    (globalThis as any).__mockNumPages = 20;
    const { pdfToImages } = await import("./pdfToImages");
    const pages = await pdfToImages(makeFile(), { maxPages: 20 });
    expect(pages).toHaveLength(20);
  });

  it("no aplica el detector de documento uniforme con <3 páginas (evita falso positivo en docs cortos)", async () => {
    // Documento de 2 páginas del mismo tamaño exacto: es raro pero puede
    // darse (portada + firma casi idénticas). Con solo 2 páginas la señal
    // es demasiado débil para bloquear.
    installCanvasMocks({ uniform: false, sizePerPage: () => 60_000 });
    (globalThis as any).__mockNumPages = 2;
    const { pdfToImages } = await import("./pdfToImages");
    const pages = await pdfToImages(makeFile(), { maxPages: 2 });
    expect(pages).toHaveLength(2);
  });

  // ── Calibración de resolución (~200 DPI para OCR legal) ────────────────

  it("Carta (612×792 pt): produce canvas >= 2200 px lado mayor (>=200 DPI)", async () => {
    installCanvasMocks({ sizePerPage: () => 400_000 });
    (globalThis as any).__basePt = { w: 612, h: 792 };
    (globalThis as any).__mockNumPages = 1;
    const { pdfToImages } = await import("./pdfToImages");
    await pdfToImages(makeFile(), { maxPages: 1 });
    const dims = (globalThis as any).__canvasDims as Array<{ w: number; h: number }>;
    const longest = Math.max(dims[0].w, dims[0].h);
    expect(longest).toBeGreaterThanOrEqual(2200);
    expect((longest / 792) * 72).toBeGreaterThanOrEqual(200);
  });

  it("Oficio colombiano (612x936 pt): produce canvas >= 2500 px lado mayor", async () => {
    installCanvasMocks({ sizePerPage: () => 500_000 });
    (globalThis as any).__basePt = { w: 612, h: 936 };
    (globalThis as any).__mockNumPages = 1;
    const { pdfToImages } = await import("./pdfToImages");
    await pdfToImages(makeFile(), { maxPages: 1 });
    const dims = (globalThis as any).__canvasDims as Array<{ w: number; h: number }>;
    const longest = Math.max(dims[0].w, dims[0].h);
    expect(longest).toBeGreaterThanOrEqual(2500);
    expect((longest / 936) * 72).toBeGreaterThanOrEqual(190);
  });

  it("PDF digital pequeno (400x500 pt): upscala hasta MAX_UPSCALE=3 en vez de quedar pixelado", async () => {
    installCanvasMocks({ sizePerPage: () => 200_000 });
    (globalThis as any).__basePt = { w: 400, h: 500 };
    (globalThis as any).__mockNumPages = 1;
    const { pdfToImages } = await import("./pdfToImages");
    await pdfToImages(makeFile(), { maxPages: 1 });
    const dims = (globalThis as any).__canvasDims as Array<{ w: number; h: number }>;
    const longest = Math.max(dims[0].w, dims[0].h);
    expect(longest).toBe(1500);
  });
});


