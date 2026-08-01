/**
 * ⚠️ HERRAMIENTA TEMPORAL DE DIAGNÓSTICO
 * Eliminar al cerrar la investigación de calidad de imagen
 * (junto con la acción `test_calidad_grayscale` del edge function procesar-cancelacion).
 *
 * Ruta: /admin/prueba-calidad — accesible sólo por URL directa, sin enlace en el menú.
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
  bytesOriginal: number;
  bytesDespeckle: number;
  componentesEliminados: number;
  tintaTotalPx: number;
  tintaEliminadaPx: number;
  porcentaje: number;
}

const BUCKET = "expediente-files";

async function loadImageData(blob: Blob): Promise<{ img: HTMLImageElement; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; data: ImageData }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No se pudo decodificar la imagen"));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D no disponible");
    ctx.drawImage(img, 0, 0);
    return { img, canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Componentes conectados (conectividad-4) de píxeles de tinta (<128). Área <= 3 px → blanco. */
function despeckle(data: ImageData) {
  const { width: w, height: h } = data;
  const px = data.data;
  const n = w * h;
  const ink = new Uint8Array(n);
  let tintaTotalPx = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // luminancia simple
    const lum = (px[o] * 299 + px[o + 1] * 587 + px[o + 2] * 114) / 1000;
    if (lum < 128) {
      ink[i] = 1;
      tintaTotalPx++;
    }
  }

  // labels: 0 = fondo/no visitado (el fondo NUNCA se cuenta como componente)
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  let componentesEliminados = 0;
  let tintaEliminadaPx = 0;
  const toClear: number[] = [];
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

  const out = new ImageData(new Uint8ClampedArray(px), w, h);
  for (const m of toClear) {
    const o = m * 4;
    out.data[o] = 255;
    out.data[o + 1] = 255;
    out.data[o + 2] = 255;
    out.data[o + 3] = 255;
  }

  const porcentaje = tintaTotalPx > 0 ? (tintaEliminadaPx / tintaTotalPx) * 100 : 0;
  return { out, componentesEliminados, tintaTotalPx, tintaEliminadaPx, porcentaje };
}

function canvasToPngBase64(data: ImageData): { b64: string; bytes: number } {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  ctx.putImageData(data, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  const b64 = dataUrl.split(",")[1] ?? "";
  return { b64, bytes: Math.floor((b64.length * 3) / 4) };
}

const AdminPruebaCalidad = () => {
  const { toast } = useToast();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [tramiteId, setTramiteId] = useState("e2433d7b-6c4a-4225-b485-0bbb6fa38c99");
  const [pagina, setPagina] = useState("p15");

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [metrics, setMetrics] = useState<DespeckleMetrics | null>(null);
  const [aborted, setAborted] = useState(false);
  const [runs, setRuns] = useState<Array<{ rgba: unknown; gray: unknown; raw: unknown }>>([]);
  const [error, setError] = useState<string | null>(null);

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

  const run = async () => {
    setRunning(true);
    setError(null);
    setRuns([]);
    setMetrics(null);
    setAborted(false);
    try {
      const path = `${tramiteId}/cancelaciones/soportes/escritura/${pagina}.png`;
      setProgress(`Descargando ${path}…`);
      const { data: blob, error: dlError } = await supabase.storage.from(BUCKET).download(path);
      if (dlError || !blob) {
        throw new Error(`no se pudo descargar la imagen (ruta o permisos): ${dlError?.message ?? "sin datos"}`);
      }

      setProgress("Procesando despeckle…");
      const { data: original } = await loadImageData(blob);
      const originalEncoded = canvasToPngBase64(original);
      const res = despeckle(original);
      const despeckleEncoded = canvasToPngBase64(res.out);

      const m: DespeckleMetrics = {
        bytesOriginal: originalEncoded.bytes,
        bytesDespeckle: despeckleEncoded.bytes,
        componentesEliminados: res.componentesEliminados,
        tintaTotalPx: res.tintaTotalPx,
        tintaEliminadaPx: res.tintaEliminadaPx,
        porcentaje: res.porcentaje,
      };
      setMetrics(m);

      if (res.porcentaje > 2) {
        setAborted(true);
        setProgress("");
        setError(`GUARDARRAÍL: el despeckle elimina ${res.porcentaje.toFixed(3)}% de la tinta (> 2%). Abortado sin invocar la IA.`);
        return;
      }

      const collected: Array<{ rgba: unknown; gray: unknown; raw: unknown }> = [];
      for (let i = 1; i <= 3; i++) {
        setProgress(`Invocando corrida ${i} de 3…`);
        const { data, error: fnError } = await supabase.functions.invoke("procesar-cancelacion", {
          body: {
            action: "test_calidad_grayscale",
            image_rgba_b64: originalEncoded.b64,
            image_gray_b64: despeckleEncoded.b64,
          },
        });
        if (fnError) {
          const ctx = (fnError as { context?: { status?: number; text?: () => Promise<string> } }).context;
          let detail = fnError.message;
          if (ctx?.text) {
            try { detail = await ctx.text(); } catch { /* noop */ }
          }
          if (ctx?.status === 403) {
            throw new Error(`sesión sin permisos de admin (403): ${detail}`);
          }
          throw new Error(`error del gateway: ${detail}`);
        }
        const payload = data as Record<string, unknown> | null;
        collected.push({
          rgba: payload?.rgba ?? payload?.transcripcion_rgba ?? null,
          gray: payload?.gray ?? payload?.transcripcion_gray ?? null,
          raw: payload,
        });
        setRuns([...collected]);
      }
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
      lines.push(`bytes original (png b64): ${metrics.bytesOriginal}`);
      lines.push(`bytes despeckle (png b64): ${metrics.bytesDespeckle}`);
      lines.push(`componentes eliminados: ${metrics.componentesEliminados}`);
      lines.push(`tinta total (px): ${metrics.tintaTotalPx}`);
      lines.push(`tinta eliminada (px): ${metrics.tintaEliminadaPx}`);
      lines.push(`% tinta eliminada: ${metrics.porcentaje.toFixed(4)}%`);
    }
    runs.forEach((r, i) => {
      lines.push("", `=== CORRIDA ${i + 1} — rgba (original) ===`, JSON.stringify(r.rgba, null, 2));
      lines.push("", `=== CORRIDA ${i + 1} — gray (despeckle) ===`, JSON.stringify(r.gray, null, 2));
      lines.push("", `=== CORRIDA ${i + 1} — JSON crudo ===`, JSON.stringify(r.raw, null, 2));
    });
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
            <Button onClick={run} disabled={running}>
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ejecutar Ronda 1 (3 corridas)
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
              <li>Bytes original (PNG b64): {metrics.bytesOriginal.toLocaleString()}</li>
              <li>Bytes despeckle (PNG b64): {metrics.bytesDespeckle.toLocaleString()}</li>
              <li>Componentes eliminados: {metrics.componentesEliminados.toLocaleString()}</li>
              <li>Tinta total (px): {metrics.tintaTotalPx.toLocaleString()}</li>
              <li>Tinta eliminada (px): {metrics.tintaEliminadaPx.toLocaleString()}</li>
              <li>% de tinta eliminada: {metrics.porcentaje.toFixed(4)}%</li>
            </ul>
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
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">JSON crudo</p>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(r.raw, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default AdminPruebaCalidad;
