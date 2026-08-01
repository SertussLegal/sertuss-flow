/**
 * ⚠️ HERRAMIENTA TEMPORAL DE DIAGNÓSTICO
 * Eliminar al cerrar la investigación de calidad de imagen
 * (junto con la acción `test_calidad_grayscale` del edge function procesar-cancelacion).
 *
 * Ruta: /admin/prueba-calidad — accesible sólo por URL directa, sin enlace en el menú.
 *
 * La descarga de la imagen y el despeckle ocurren EN EL SERVIDOR (service role),
 * exclusivamente para esta herramienta temporal.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

const AdminPruebaCalidad = () => {
  const { toast } = useToast();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [tramiteId, setTramiteId] = useState("e2433d7b-6c4a-4225-b485-0bbb6fa38c99");
  const [pagina, setPagina] = useState("p15");

  const [debugOnly, setDebugOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [metrics, setMetrics] = useState<DespeckleMetrics | null>(null);
  const [aborted, setAborted] = useState(false);
  const [runs, setRuns] = useState<Corrida[]>([]);
  const [images, setImages] = useState<{ original: string; despeckle: string } | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
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
    setImages(null);
    setMetrics(null);
    setRaw(null);
    setAborted(false);
    setProgress(
      debugOnly
        ? "Ejecutando en el servidor (descarga + despeckle, sin IA)…"
        : "Ejecutando en el servidor (descarga + despeckle + 3 corridas)…",
    );
    try {
      const { data, error: fnError } = await supabase.functions.invoke("procesar-cancelacion", {
        body: {
          action: "test_calidad_grayscale",
          tramite_id: tramiteId,
          pagina,
          ...(debugOnly ? { debug_return_image: true } : {}),
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
      setMetrics((payload?.metricas as DespeckleMetrics) ?? null);

      if (payload?.stage === "download") {
        setRaw(payload);
        throw new Error(`no se pudo descargar la imagen: ${JSON.stringify(payload.storage_error)}`);
      }
      if (payload?.abortado_por_guardarrail) {
        setRaw(payload);
        setAborted(true);
        setProgress("");
        setError(String(payload.message ?? "Guardarraíl activado. No se invocó la IA."));
        return;
      }
      if (payload?.ok !== true) {
        setRaw(payload);
        throw new Error(String(payload?.error ?? "respuesta inesperada del servidor"));
      }

      if (payload.debug === true) {
        setImages({
          original: String(payload.original_png_b64 ?? ""),
          despeckle: String(payload.despeckle_png_b64 ?? ""),
        });
        // No volcamos el JSON crudo: contiene los PNG completos en base64.
        setRaw({ ok: true, debug: true, metricas: payload.metricas, imagenes: "(omitidas del JSON crudo)" });
        setProgress("Listo (sin IA).");
        return;
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
          <div className="flex items-center gap-2">
            <Checkbox
              id="debug-only"
              checked={debugOnly}
              onCheckedChange={(v) => setDebugOnly(v === true)}
            />
            <Label htmlFor="debug-only" className="cursor-pointer text-sm font-normal">
              Solo ver imágenes (sin invocar IA)
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} disabled={running}>
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {debugOnly ? "Ver imágenes (sin IA)" : "Ejecutar Ronda 1 (3 corridas)"}
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
            <CardTitle className="text-base">Imágenes (modo depuración, sin IA)</CardTitle>
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
