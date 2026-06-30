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
import { Loader2, FileWarning, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "expediente-files";
const SIGNED_URL_TTL_SECONDS = 15 * 60; // 15 min — corto por Ley 1581.

interface PoderViewerTabProps {
  cancelacionId: string;
}

export function PoderViewerTab({ cancelacionId }: PoderViewerTabProps) {
  const [state, setState] = useState<"loading" | "empty" | "ready" | "error">("loading");
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
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
