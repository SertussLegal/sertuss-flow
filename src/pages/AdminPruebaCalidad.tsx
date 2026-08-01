/**
 * ⚠️ HERRAMIENTA TEMPORAL DE DIAGNÓSTICO
 * Eliminar al cerrar la investigación de calidad de imagen
 * (junto con la acción `test_calidad_grayscale` del edge function procesar-cancelacion).
 *
 * Ruta: /admin/prueba-calidad — accesible sólo por URL directa, sin enlace en el menú.
 *
 * El servidor sólo hace la descarga cruda (service role) y las llamadas a la IA.
 * El decode del PNG, el despeckle y las métricas ocurren EN EL NAVEGADOR.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertTriangle, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DespeckleMetrics {
  path?: string;
  width?: number;
  height?: number;
  bytes_original?: number;
  bytes_despeckle?: number;
  componentes_eliminados?: number;
  tinta_total_px?: number;
  tinta_eliminada_px?: number;
  porcentaje_tinta_eliminada?: number;
}

interface Corrida {
  rgba: unknown;
  gray: unknown;
}

const b64ToBytes = (b64: string) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const canvasToPngB64 = (canvas: HTMLCanvasElement) =>
  canvas.toDataURL("image/png").split(",")[1] ?? "";

const AdminPruebaCalidad = () => {
  const { toast } = useToast();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [tramiteId, setTramiteId] = useState("e2433d7b-6c4a-4225-b485-0bbb6fa38c99");
  const [pagina, setPagina] = useState("p15");

  const [loadingImages, setLoadingImages] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [metrics, setMetrics] = useState<DespeckleMetrics | null>(null);
  const [aborted, setAborted] = useState(false);
  const [runs, setRuns] = useState<Corrida[]>([]);
  const [images, setImages] = useState<{ original: string; despeckle: string } | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<{ nombre: string; src: string }[]>([]);
  const [loadingThumbs, setLoadingThumbs] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (!cancelled) { setIsAdmin(false); setChecking(false); }
          return;
        }
        const { data, error } = await supabase.rpc("is_platform_admin");
        if (!cancelled) {
          setIsAdmin(!error && data === true);
          setChecking(false);
        }
      } catch {
        if (!cancelled) { setIsAdmin(false); setChecking(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const invokeFn = async (body: Record<string, unknown>) => {
    const { data, error: fnError } = await supabase.functions.invoke("procesar-cancelacion", { body });
    if (fnError) {
      const ctx = (fnError as { context?: { status?: number; text?: () => Promise<string> } }).context;
      let detail = fnError.message;
      if (ctx?.text) {
        try { detail = await ctx.text(); } catch { /* noop */ }
      }
      if (ctx?.status === 403) throw new Error(`sesión sin permisos de admin (403): ${detail}`);
      throw new Error(`error del gateway: ${detail}`);
    }
    return data as Record<string, unknown> | null;
  };

  /** Decode PNG + despeckle + métricas — compartido por storage y subida manual. */
  const processImageBytes = async (
    bytes: Uint8Array,
    pathLabel: string,
  ): Promise<{ metricas: DespeckleMetrics; images: { original: string; despeckle: string } }> => {
    const bytesOriginal = bytes.length;

    setProgress("Decodificando en el navegador…");
    const img = new Image();
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "image/png" });
    const objectUrl = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("no se pudo decodificar el PNG en el navegador"));
      img.src = objectUrl;
    });

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no se pudo crear el contexto 2D");
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(objectUrl);

    const originalB64 = canvasToPngB64(canvas);

    setProgress("Aplicando despeckle (≤3px)…");
    const imageData = ctx.getImageData(0, 0, w, h);
    const rgba = imageData.data;
    const n = w * h;
    const ink = new Uint8Array(n);
    let tintaTotalPx = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const lum = (rgba[o] * 299 + rgba[o + 1] * 587 + rgba[o + 2] * 114) / 1000;
      if (lum < 128) { ink[i] = 1; tintaTotalPx++; }
    }
    const labels = new Int32Array(n);
    const stack = new Int32Array(n);
    const toClear: number[] = [];
    let componentesEliminados = 0;
    let tintaEliminadaPx = 0;
    let label = 0;
    for (let start = 0; start < n; start++) {
      if (!ink[start] || labels[start] !== 0) continue;
      label++;
      let sp = 0;
      stack[sp++] = start;
      labels[start] = label;
      const members: number[] = [];
      while (sp > 0) {
        const cur = stack[--sp];
        members.push(cur);
        const x = cur % w;
        const y = (cur - x) / w;
        if (x > 0) { const k = cur - 1; if (ink[k] && labels[k] === 0) { labels[k] = label; stack[sp++] = k; } }
        if (x < w - 1) { const k = cur + 1; if (ink[k] && labels[k] === 0) { labels[k] = label; stack[sp++] = k; } }
        if (y > 0) { const k = cur - w; if (ink[k] && labels[k] === 0) { labels[k] = label; stack[sp++] = k; } }
        if (y < h - 1) { const k = cur + w; if (ink[k] && labels[k] === 0) { labels[k] = label; stack[sp++] = k; } }
      }
      if (members.length <= 3) {
        componentesEliminados++;
        tintaEliminadaPx += members.length;
        for (const m of members) toClear.push(m);
      }
    }
    const porcentaje = tintaTotalPx > 0 ? (tintaEliminadaPx / tintaTotalPx) * 100 : 0;

    const metricasBase: DespeckleMetrics = {
      path: pathLabel,
      width: w,
      height: h,
      bytes_original: bytesOriginal,
      bytes_despeckle: 0,
      componentes_eliminados: componentesEliminados,
      tinta_total_px: tintaTotalPx,
      tinta_eliminada_px: tintaEliminadaPx,
      porcentaje_tinta_eliminada: porcentaje,
    };

    if (porcentaje > 2) {
      setMetrics(metricasBase);
      setAborted(true);
      setProgress("");
      throw new Error(
        `El despeckle elimina ${porcentaje.toFixed(4)}% de la tinta (> 2%). No se generaron imágenes ni se invocó la IA.`,
      );
    }

    for (const m of toClear) {
      const o = m * 4;
      rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255; rgba[o + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    const despeckleB64 = canvasToPngB64(canvas);
    metricasBase.bytes_despeckle = b64ToBytes(despeckleB64).length;

    return { metricas: metricasBase, images: { original: originalB64, despeckle: despeckleB64 } };
  };

  /** Subida manual de un PNG local. */
  const handleManualFile = async (file: File) => {
    setLoadingImages(true);
    setError(null);
    setRuns([]);
    setImages(null);
    setMetrics(null);
    setRaw(null);
    setAborted(false);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { metricas, images: imgs } = await processImageBytes(bytes, file.name);
      setMetrics(metricas);
      setImages(imgs);
      setRaw({ ok: true, paso: "imagenes_listas", origen: "subida_manual", metricas });
      setProgress("Imágenes listas. Ya puedes ejecutar la Ronda 1.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress("");
    } finally {
      setLoadingImages(false);
    }
  };

  /** Paso 1 — descarga cruda + decode + despeckle en el navegador. */
  const loadImages = async (paginaArg?: string) => {
    const pg = paginaArg ?? pagina;
    setLoadingImages(true);
    setError(null);
    setRuns([]);
    setImages(null);
    setMetrics(null);
    setRaw(null);
    setAborted(false);
    setProgress("Descargando PNG crudo del servidor…");
    try {
      const payload = await invokeFn({
        action: "test_calidad_grayscale",
        fetch_raw: true,
        tramite_id: tramiteId,
        pagina: pg,
      });


      if (payload?.stage === "download") {
        setRaw(payload);
        throw new Error(`no se pudo descargar la imagen: ${JSON.stringify(payload.storage_error)}`);
      }
      if (payload?.ok !== true || typeof payload.raw_png_b64 !== "string") {
        setRaw(payload);
        throw new Error(String(payload?.error ?? "respuesta inesperada del servidor"));
      }

      const rawB64 = payload.raw_png_b64 as string;
      const bytesOriginal = b64ToBytes(rawB64).length;

      setProgress("Decodificando en el navegador…");
      const img = new Image();
      const objectUrl = URL.createObjectURL(new Blob([b64ToBytes(rawB64)], { type: "image/png" }));
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("no se pudo decodificar el PNG en el navegador"));
        img.src = objectUrl;
      });

      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no se pudo crear el contexto 2D");
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);

      const originalB64 = canvasToPngB64(canvas);

      setProgress("Aplicando despeckle (≤3px)…");
      const imageData = ctx.getImageData(0, 0, w, h);
      const rgba = imageData.data;
      const n = w * h;
      const ink = new Uint8Array(n);
      let tintaTotalPx = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const lum = (rgba[o] * 299 + rgba[o + 1] * 587 + rgba[o + 2] * 114) / 1000;
        if (lum < 128) { ink[i] = 1; tintaTotalPx++; }
      }
      const labels = new Int32Array(n);
      const stack = new Int32Array(n);
      const toClear: number[] = [];
      let componentesEliminados = 0;
      let tintaEliminadaPx = 0;
      let label = 0;
      for (let start = 0; start < n; start++) {
        if (!ink[start] || labels[start] !== 0) continue;
        label++;
        let sp = 0;
        stack[sp++] = start;
        labels[start] = label;
        const members: number[] = [];
        while (sp > 0) {
          const cur = stack[--sp];
          members.push(cur);
          const x = cur % w;
          const y = (cur - x) / w;
          if (x > 0) { const k = cur - 1; if (ink[k] && labels[k] === 0) { labels[k] = label; stack[sp++] = k; } }
          if (x < w - 1) { const k = cur + 1; if (ink[k] && labels[k] === 0) { labels[k] = label; stack[sp++] = k; } }
          if (y > 0) { const k = cur - w; if (ink[k] && labels[k] === 0) { labels[k] = label; stack[sp++] = k; } }
          if (y < h - 1) { const k = cur + w; if (ink[k] && labels[k] === 0) { labels[k] = label; stack[sp++] = k; } }
        }
        if (members.length <= 3) {
          componentesEliminados++;
          tintaEliminadaPx += members.length;
          for (const m of members) toClear.push(m);
        }
      }
      const porcentaje = tintaTotalPx > 0 ? (tintaEliminadaPx / tintaTotalPx) * 100 : 0;

      const metricasBase: DespeckleMetrics = {
        path: `${tramiteId}/cancelaciones/soportes/escritura/${pg}.png`,
        width: w,
        height: h,
        bytes_original: bytesOriginal,
        bytes_despeckle: 0,
        componentes_eliminados: componentesEliminados,
        tinta_total_px: tintaTotalPx,
        tinta_eliminada_px: tintaEliminadaPx,
        porcentaje_tinta_eliminada: porcentaje,
      };

      if (porcentaje > 2) {
        setMetrics(metricasBase);
        setAborted(true);
        setProgress("");
        setError(
          `El despeckle elimina ${porcentaje.toFixed(4)}% de la tinta (> 2%). No se generaron imágenes ni se invocó la IA.`,
        );
        return;
      }

      for (const m of toClear) {
        const o = m * 4;
        rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255; rgba[o + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      const despeckleB64 = canvasToPngB64(canvas);

      metricasBase.bytes_despeckle = b64ToBytes(despeckleB64).length;
      setMetrics(metricasBase);
      setImages({ original: originalB64, despeckle: despeckleB64 });
      setRaw({ ok: true, paso: "imagenes_listas", metricas: metricasBase });
      setProgress("Imágenes listas. Ya puedes ejecutar la Ronda 1.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress("");
    } finally {
      setLoadingImages(false);
    }
  };

  /** Vista rápida — listado + miniaturas generadas en el navegador. */
  const loadThumbs = async () => {
    setLoadingThumbs(true);
    setError(null);
    setThumbs([]);
    setProgress("Listando páginas…");
    try {
      const listPayload = await invokeFn({
        action: "test_calidad_grayscale",
        fetch_raw: true,
        tramite_id: tramiteId,
        pagina: "ALL",
      });
      if (listPayload?.ok !== true || !Array.isArray(listPayload.listado)) {
        setRaw(listPayload);
        throw new Error(String(listPayload?.error ?? "no se pudo listar las páginas"));
      }
      const listado = listPayload.listado as { nombre: string }[];
      const total = listado.length;
      let done = 0;
      setProgress(`Cargando 0/${total}…`);

      const results: { nombre: string; src: string }[] = new Array(total);
      const makeThumb = async (nombre: string) => {
        const p = await invokeFn({
          action: "test_calidad_grayscale",
          fetch_raw: true,
          tramite_id: tramiteId,
          pagina: nombre,
        });
        if (p?.ok !== true || typeof p.raw_png_b64 !== "string") throw new Error(`falló ${nombre}`);
        const url = URL.createObjectURL(
          new Blob([b64ToBytes(p.raw_png_b64 as string)], { type: "image/png" }),
        );
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`no se pudo decodificar ${nombre}`));
          img.src = url;
        });
        const tw = 180;
        const th = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * tw));
        const canvas = document.createElement("canvas");
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no se pudo crear el contexto 2D");
        ctx.drawImage(img, 0, 0, tw, th);
        URL.revokeObjectURL(url);
        return `data:image/png;base64,${canvasToPngB64(canvas)}`;
      };

      let cursor = 0;
      const worker = async () => {
        while (cursor < total) {
          const idx = cursor++;
          const nombre = listado[idx].nombre;
          try {
            results[idx] = { nombre, src: await makeThumb(nombre) };
          } catch {
            results[idx] = { nombre, src: "" };
          }
          done++;
          setProgress(`Cargando ${done}/${total}…`);
          setThumbs(results.filter(Boolean));
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, total) }, worker));
      setThumbs(results.filter(Boolean));
      setProgress(`${total} páginas cargadas.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress("");
    } finally {
      setLoadingThumbs(false);
    }
  };

  /** Paso 2 — envía ambas imágenes al servidor para las 3 corridas de IA. */
  const runRonda1 = async () => {
    if (!images) return;
    setRunning(true);
    setError(null);
    setRuns([]);
    setProgress("Ejecutando 3 corridas en el servidor…");
    try {
      const payload = await invokeFn({
        action: "test_calidad_grayscale",
        image_rgba_b64: images.original,
        image_gray_b64: images.despeckle,
      });
      if (payload?.ok !== true) {
        setRaw(payload);
        throw new Error(String(payload?.error ?? "respuesta inesperada del servidor"));
      }
      setRaw(payload);
      setRuns((payload.corridas as Corrida[]) ?? []);
      setProgress("Listo.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress("");
    } finally {
      setRunning(false);
    }
  };

  const copyAll = async () => {
    const lines: string[] = [];
    if (metrics) {
      lines.push("=== MÉTRICAS DESPECKLE ===");
      lines.push(JSON.stringify(metrics, null, 2));
    }
    runs.forEach((r, i) => {
      lines.push("", `=== CORRIDA ${i + 1} — rgba (original) ===`, JSON.stringify(r.rgba, null, 2));
      lines.push("", `=== CORRIDA ${i + 1} — gray (despeckle) ===`, JSON.stringify(r.gray, null, 2));
    });
    lines.push("", "=== JSON CRUDO ===", JSON.stringify(raw, null, 2));
    await navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "Copiado", description: "Métricas y respuestas copiadas al portapapeles." });
  };

  if (checking) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-foreground">Acceso restringido</h1>
      </div>
    );
  }

  const busy = loadingImages || running || loadingThumbs;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <p className="text-sm text-foreground">
          ⚠️ HERRAMIENTA TEMPORAL DE DIAGNÓSTICO — eliminar al cerrar la investigación de calidad de
          imagen (junto con la acción <code>test_calidad_grayscale</code>).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prueba de calidad de imagen — Ronda 1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tramite">Trámite ID</Label>
              <Input id="tramite" value={tramiteId} onChange={(e) => setTramiteId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pagina">Página</Label>
              <Input id="pagina" value={pagina} onChange={(e) => setPagina(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => loadImages()} disabled={busy}>
              {loadingImages && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cargar y ver imágenes
            </Button>
            <Button onClick={runRonda1} disabled={busy || !images} variant="secondary">
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ejecutar Ronda 1 (3 corridas)
            </Button>
            <Button onClick={loadThumbs} disabled={busy} variant="outline">
              {loadingThumbs && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Vista rápida (miniaturas)
            </Button>


            {(metrics || runs.length > 0) && (
              <Button variant="outline" onClick={copyAll}>
                <Copy className="mr-2 h-4 w-4" /> Copiar todo
              </Button>
            )}
            {progress && <span className="text-sm text-muted-foreground">{progress}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Ruta: <code>{`${tramiteId}/cancelaciones/soportes/escritura/${pagina}.png`}</code>
          </p>
        </CardContent>
      </Card>

      {thumbs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Miniaturas ({thumbs.length}) — clic para abrir a tamaño completo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8 xl:grid-cols-10">
              {thumbs.map((t) => (
                <button
                  key={t.nombre}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPagina(t.nombre);
                    void loadImages(t.nombre);
                  }}
                  className="group space-y-1 rounded-md border border-border p-1 text-left transition-colors hover:border-primary disabled:opacity-50"
                >
                  {t.src ? (
                    <img src={t.src} alt={`Página ${t.nombre}`} className="w-full rounded-sm" />
                  ) : (
                    <div className="flex h-24 items-center justify-center text-xs text-destructive">
                      error
                    </div>
                  )}
                  <span className="block text-center text-xs text-muted-foreground group-hover:text-foreground">
                    {t.nombre}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}



      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {metrics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Métricas del despeckle</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className={`space-y-1 text-sm ${aborted ? "text-destructive" : "text-foreground"}`}>
              <li>Dimensiones: {metrics.width} × {metrics.height}</li>
              <li>Bytes original (PNG): {(metrics.bytes_original ?? 0).toLocaleString()}</li>
              <li>Bytes despeckle (PNG): {(metrics.bytes_despeckle ?? 0).toLocaleString()}</li>
              <li>Componentes eliminados: {(metrics.componentes_eliminados ?? 0).toLocaleString()}</li>
              <li>Tinta total (px): {(metrics.tinta_total_px ?? 0).toLocaleString()}</li>
              <li>Tinta eliminada (px): {(metrics.tinta_eliminada_px ?? 0).toLocaleString()}</li>
              <li>% de tinta eliminada: {(metrics.porcentaje_tinta_eliminada ?? 0).toFixed(4)}%</li>
            </ul>
          </CardContent>
        </Card>
      )}

      {images && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Imágenes procesadas en el navegador</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <figure className="space-y-2">
              <figcaption className="text-xs font-semibold text-muted-foreground">Original</figcaption>
              <img
                src={`data:image/png;base64,${images.original}`}
                alt="Página original sin despeckle"
                className="w-full rounded-md border border-border"
              />
            </figure>
            <figure className="space-y-2">
              <figcaption className="text-xs font-semibold text-muted-foreground">Despeckle</figcaption>
              <img
                src={`data:image/png;base64,${images.despeckle}`}
                alt="Página con despeckle aplicado"
                className="w-full rounded-md border border-border"
              />
            </figure>
          </CardContent>
        </Card>
      )}

      {runs.map((r, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle className="text-base">Corrida {i + 1}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">rgba (original)</p>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(r.rgba, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">gray (despeckle)</p>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(r.gray, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      ))}

      {raw != null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">JSON crudo</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(raw, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminPruebaCalidad;
