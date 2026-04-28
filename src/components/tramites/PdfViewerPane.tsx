import { useCallback, useEffect, useRef, useState } from "react";
import mammoth from "mammoth";
import { Loader2, AlertTriangle, Download, RotateCw, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface PdfViewerPaneProps {
  tramiteId: string;
  docxPath: string | null;
}

type ViewerState = "idle" | "loading" | "ready" | "error";

interface ErrorInfo {
  title: string;
  description: string;
}

const SIGNED_URL_TTL_SECONDS = 300;

const classifyError = (err: any): ErrorInfo => {
  const msg = String(err?.message || err || "").toLowerCase();
  if (msg.includes("not found") || msg.includes("404") || msg.includes("does not exist")) {
    return {
      title: "Documento no encontrado",
      description:
        "El archivo ya no está disponible en la nube. Vuelve a generar el documento para crear una nueva copia.",
    };
  }
  if (msg.includes("403") || msg.includes("unauthorized") || msg.includes("permission")) {
    return {
      title: "Sin permisos para ver este documento",
      description:
        "Tu sesión no tiene acceso a este archivo. Verifica que sigues vinculado a la organización del trámite.",
    };
  }
  return {
    title: "No pudimos cargar el documento",
    description:
      "Hubo un problema de red o del servidor. Reintenta en unos segundos; si persiste, vuelve a generar el documento.",
  };
};

const PdfViewerPane = ({ tramiteId, docxPath }: PdfViewerPaneProps) => {
  const [state, setState] = useState<ViewerState>("idle");
  const [html, setHtml] = useState<string>("");
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!docxPath) {
      setState("idle");
      setHtml("");
      setSignedUrl(null);
      return;
    }

    const reqId = ++reqIdRef.current;
    setState("loading");
    setError(null);

    try {
      const { data: signed, error: signError } = await supabase
        .storage
        .from("expediente-files")
        .createSignedUrl(docxPath, SIGNED_URL_TTL_SECONDS);

      if (signError || !signed?.signedUrl) {
        throw signError ?? new Error("No se pudo firmar la URL del documento");
      }

      if (reqId !== reqIdRef.current) return;
      setSignedUrl(signed.signedUrl);

      const res = await fetch(signed.signedUrl);
      if (!res.ok) {
        throw new Error(res.status === 404 ? "404 not found" : `HTTP ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });

      if (reqId !== reqIdRef.current) return;
      setHtml(result.value || "<p><em>(Documento vacío)</em></p>");
      setState("ready");
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      console.error("[PdfViewerPane] load error", err);
      setError(classifyError(err));
      setState("error");
    }
  }, [docxPath]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = async () => {
    if (!signedUrl) return;
    // Force download: open the signed URL in a new tab; storage serves as octet-stream attachment
    const link = document.createElement("a");
    link.href = signedUrl;
    link.download = docxPath?.split("/").pop() || `documento-${tramiteId.slice(0, 8)}.docx`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="pdf-viewer-pane h-full w-full overflow-auto bg-slate-900/40">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-slate-950/80 backdrop-blur border-b border-white/10">
        <div className="flex items-center gap-2 text-xs text-white/70">
          <FileText className="h-4 w-4 text-notarial-gold" />
          <span>Vista final del documento</span>
        </div>
        <div className="flex items-center gap-2">
          {state === "ready" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleDownload}
              className="h-8 text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Descargar .docx
            </Button>
          )}
          {(state === "ready" || state === "error") && (
            <Button
              size="sm"
              variant="ghost"
              onClick={load}
              className="h-8 text-xs text-white/70 hover:text-white"
              title="Recargar"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex justify-center py-8 px-4">
        {state === "idle" && (
          <div className="max-w-md mt-16 text-center text-white/60 text-sm">
            <FileText className="h-10 w-10 mx-auto mb-3 text-white/30" />
            Aún no se ha generado el documento. Pulsa <span className="text-notarial-gold">Previsualizar</span>
            {" "}y luego <span className="text-notarial-gold">Generar</span> para crear la primera versión.
          </div>
        )}

        {state === "loading" && (
          <div className="flex items-center gap-3 text-white/70 mt-16">
            <Loader2 className="h-5 w-5 animate-spin text-notarial-gold" />
            <span className="text-sm">Cargando documento desde la nube…</span>
          </div>
        )}

        {state === "error" && error && (
          <div className="max-w-md mt-12 rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-destructive" />
            <h3 className="text-sm font-semibold text-white mb-1">{error.title}</h3>
            <p className="text-xs text-white/70 mb-4">{error.description}</p>
            <Button size="sm" variant="outline" onClick={load}>
              <RotateCw className="h-3.5 w-3.5 mr-1.5" />
              Reintentar
            </Button>
          </div>
        )}

        {state === "ready" && (
          <article
            className="pdf-viewer-page shadow-2xl"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
};

export default PdfViewerPane;
