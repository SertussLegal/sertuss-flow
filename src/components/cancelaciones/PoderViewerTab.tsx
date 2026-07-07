// ============================================================================
// PoderViewerTab — Visor defensivo de las páginas del Poder General del
// Banco. Plan v5/B4 (Ley 1581).
//
// REGLAS DE CICLO DE VIDA (no negociables):
//  - Las URL firmadas tienen TTL corto (15 min) — el usuario no las puede
//    compartir indefinidamente.
//  - Al desmontar el componente (cambio de tab, navegación, etc.) React
//    descarta el estado: las URL desaparecen del DOM y de la memoria del
//    visor. No persistimos nada en localStorage ni en globals.
//  - Si una request asíncrona vuelve después de desmontar, el flag
//    `aliveRef` evita setState sobre un componente muerto.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { Loader2, FileWarning, ShieldCheck, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "expediente-files";
const SIGNED_URL_TTL_SECONDS = 15 * 60; // 15 min — corto por Ley 1581.

interface PoderViewerTabProps {
  cancelacionId: string;
}

// ── V6 read-only panel ─────────────────────────────────────────────────────
type V6Payload = Record<string, unknown> | null;

function hasV6Signal(pb: V6Payload): boolean {
  if (!pb || typeof pb !== "object") return false;
  return !!(pb.apoderado || pb.poderdante || pb.instrumento_poder);
}

function V6ChainPanel({ pb }: { pb: V6Payload }) {
  const [open, setOpen] = useState(false);
  if (!hasV6Signal(pb)) return null;
  const apo = (pb!.apoderado ?? {}) as Record<string, unknown>;
  const pod = (pb!.poderdante ?? {}) as Record<string, unknown>;
  const inst = (pb!.instrumento_poder ?? {}) as Record<string, unknown>;
  const reps = Array.isArray(apo.representantes) ? (apo.representantes as Array<Record<string, unknown>>) : [];
  const tipo = typeof apo.tipo === "string" ? apo.tipo : null;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-md border border-primary/30 bg-primary/5 text-xs"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-medium text-primary">
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        Cadena de representación (v6)
        {tipo && <span className="ml-auto rounded bg-primary/10 px-2 py-0.5 text-[10px] uppercase">{tipo}</span>}
      </summary>
      <div className="space-y-3 border-t border-primary/20 px-3 py-2 text-muted-foreground">
        {pod.entidad_nombre != null && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground/60">Poderdante</div>
            <div className="text-foreground">{String(pod.entidad_nombre ?? "")}</div>
            {pod.entidad_nit != null && <div>NIT: {String(pod.entidad_nit)}</div>}
            {pod.representante_legal_nombre != null && (
              <div>Firma: {String(pod.representante_legal_nombre)} {pod.representante_legal_cargo ? `(${String(pod.representante_legal_cargo)})` : ""}</div>
            )}
          </div>
        )}
        {tipo === "juridica" && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground/60">Sociedad apoderada</div>
            <div className="text-foreground">{String(apo.sociedad_razon_social ?? "—")}</div>
            {apo.sociedad_nit != null && <div>NIT: {String(apo.sociedad_nit)}</div>}
          </div>
        )}
        {reps.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground/60">Representantes designados</div>
            <ul className="space-y-0.5">
              {reps.map((r, i) => (
                <li key={i} className="text-foreground">
                  {String(r.nombre ?? "—")} — C.C. {String(r.cedula ?? "—")} {r.cargo ? `· ${String(r.cargo)}` : ""}
                  {r.es_firmante === false && <span className="ml-1 text-destructive">(no firma)</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(inst.escritura_num || inst.notaria_numero) && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground/60">Instrumento del poder</div>
            <div>Escritura N° {String(inst.escritura_num ?? "—")} · Notaría {String(inst.notaria_numero ?? "—")} de {String(inst.notaria_ciudad ?? "—")}</div>
            {inst.fecha_texto && <div>{String(inst.fecha_texto)}</div>}
          </div>
        )}
        <div className="border-t border-primary/10 pt-2 text-[10px] italic">
          Vista de solo lectura. La edición manual del bloque profundo aún no está disponible.
        </div>
      </div>
    </details>
  );
}

export function PoderViewerTab({ cancelacionId }: PoderViewerTabProps) {
  const [state, setState] = useState<"loading" | "empty" | "ready" | "error">("loading");
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [pbV6, setPbV6] = useState<V6Payload>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const load = async () => {
      try {
        const prefix = `${cancelacionId}/cancelaciones/soportes/poder`;
        const { data: files, error: listErr } = await supabase
          .storage
          .from(BUCKET)
          .list(prefix);
        if (!aliveRef.current) return;
        if (listErr) {
          setError(listErr.message);
          setState("error");
          return;
        }
        const jpgs = (files ?? [])
          .filter((f) => f.name && /\.jpe?g$/i.test(f.name))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => `${prefix}/${f.name}`);
        if (jpgs.length === 0) {
          setState("empty");
          return;
        }
        const signed = await Promise.all(
          jpgs.map(async (p) => {
            const { data } = await supabase.storage.from(BUCKET).createSignedUrl(p, SIGNED_URL_TTL_SECONDS);
            return data?.signedUrl ?? "";
          }),
        );
        if (!aliveRef.current) return;
        const urls = signed.filter(Boolean);
        setPages(urls);
        // Best-effort: cargar poder_banco de la BD para detectar bloques v6.
        // Silencioso ante error → el panel simplemente no aparece.
        try {
          const { data: cancRow } = await supabase
            .from("cancelaciones")
            .select("data_final, data_ia")
            .eq("id", cancelacionId)
            .maybeSingle();
          if (aliveRef.current && cancRow) {
            const df = (cancRow.data_final ?? {}) as Record<string, unknown>;
            const di = (cancRow.data_ia ?? {}) as Record<string, unknown>;
            const pb = (df.poder_banco ?? di.poder_banco ?? null) as V6Payload;
            setPbV6(pb);
          }
        } catch {
          // Ignorar: panel v6 es informativo, no crítico.
        }
        setState(urls.length > 0 ? "ready" : "error");
      } catch (e) {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : "unknown");
        setState("error");
      }
    };
    void load();

    return () => {
      // Defensa Ley 1581: al desmontar, vaciamos URL firmadas y bandera de
      // vida. Cualquier fetch en vuelo descarta su setState al regresar.
      aliveRef.current = false;
      setPages([]);
    };
  }, [cancelacionId]);

  if (state === "loading") {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando páginas del Poder…
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="flex h-full items-center justify-center text-center px-6">
        <div className="max-w-sm space-y-2 text-sm text-muted-foreground">
          <FileWarning className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <p className="font-medium text-foreground">No hay Poder General adjunto</p>
          <p className="text-xs">
            Esta cancelación se procesó sin Poder. Si el banco actúa mediante apoderado, vuelve a la pantalla de carga y adjunta el PDF.
          </p>
        </div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="flex h-full items-center justify-center text-center px-6">
        <div className="max-w-sm space-y-2 text-sm text-destructive">
          <FileWarning className="h-8 w-8 mx-auto" />
          <p className="font-medium">No se pudieron firmar las páginas</p>
          <p className="text-xs text-muted-foreground">{error || "Reintenta cambiando de pestaña."}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-auto px-6 py-4 space-y-3">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        URLs firmadas con vigencia de 15 min. Al salir de esta pestaña, se eliminan del visor.
      </div>
      {pages.map((url, i) => (
        <figure key={url} className="rounded-md border border-border bg-background shadow-sm overflow-hidden">
          <img
            src={url}
            alt={`Página ${i + 1} del Poder General`}
            className="w-full h-auto block"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <figcaption className="text-[10px] text-muted-foreground text-center py-1 border-t border-border bg-muted/30">
            Página {i + 1} de {pages.length}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
