import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { monitored } from "@/services/monitoredClient";
import { useAuth } from "@/contexts/AuthContext";
import { emitCreditsBlocked, isCreditsBlockedError } from "@/lib/creditsBus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { pdfToImages } from "@/lib/pdfToImages";

const BANCO_FIJO = "Banco Davivienda S.A.";
const BUCKET_OUTPUT = "expediente-files";

// Límites defensivos para proteger el navegador del usuario.
const MAX_ESCRITURA_BYTES = 80 * 1024 * 1024; // 80 MB
const MAX_CERTIFICADO_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_PODER_BYTES = 40 * 1024 * 1024; // 40 MB
const ESCRITURA_MAX_PAGES = 10;
const CERTIFICADO_MAX_PAGES = 3;
const PODER_MAX_PAGES = 25;

const StepNumber = ({ n }: { n: number }) => (
  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
    {n}
  </span>
);

export const CancelacionNueva = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeOrgId, refreshCredits } = useAuth();

  const [certificado, setCertificado] = useState<File | null>(null);
  const [escritura, setEscritura] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [stepLabel, setStepLabel] = useState<string>("");

  const handleCancel = () => {
    if (saving) return;
    navigate("/cancelaciones");
  };

  const uploadPdfAsImages = async (
    cancelacionId: string,
    file: File,
    kind: "certificado" | "escritura",
    maxPages: number,
  ): Promise<string[]> => {
    setStepLabel(`Renderizando ${kind} (primeras ${maxPages} páginas)…`);
    const pages = await pdfToImages(file, { maxPages });
    if (pages.length === 0) throw new Error(`El ${kind} no contiene páginas válidas.`);

    setStepLabel(`Subiendo ${pages.length} imágenes de ${kind}…`);
    const basePath = `${cancelacionId}/cancelaciones/soportes/${kind}`;
    const paths: string[] = [];
    for (const p of pages) {
      const path = `${basePath}/p${String(p.pageNumber).padStart(2, "0")}.jpg`;
      const { error } = await supabase.storage.from(BUCKET_OUTPUT).upload(path, p.blob, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (error) throw new Error(`Subiendo página ${p.pageNumber} de ${kind}: ${error.message}`);
      paths.push(path);
    }
    return paths;
  };

  const handleSubmit = async () => {
    if (!activeOrgId) {
      toast.error("No hay organización activa");
      return;
    }
    if (!certificado || !escritura) {
      toast.error("Debes adjuntar ambos documentos");
      return;
    }
    if (certificado.size > MAX_CERTIFICADO_BYTES) {
      toast.error("Certificado demasiado grande", {
        description: `El certificado supera ${Math.round(MAX_CERTIFICADO_BYTES / 1024 / 1024)} MB. Comprime el PDF antes de subirlo.`,
      });
      return;
    }
    if (escritura.size > MAX_ESCRITURA_BYTES) {
      toast.error("Escritura demasiado grande", {
        description: `La escritura supera ${Math.round(MAX_ESCRITURA_BYTES / 1024 / 1024)} MB. Comprime el PDF antes de subirlo.`,
      });
      return;
    }

    setSaving(true);
    try {
      setStepLabel("Creando borrador…");
      const { data: inserted, error: insErr } = await supabase
        .from("cancelaciones")
        .insert({ organization_id: activeOrgId, status: "draft" })
        .select("id")
        .single();
      if (insErr || !inserted) throw insErr ?? new Error("No se pudo crear");
      const cancelacionId = inserted.id;

      // Ambos PDFs se convierten a JPEG: el AI Gateway solo acepta image_url con imágenes.
      const certificadoImagePaths = await uploadPdfAsImages(cancelacionId, certificado, "certificado", CERTIFICADO_MAX_PAGES);
      const escrituraImagePaths = await uploadPdfAsImages(cancelacionId, escritura, "escritura", ESCRITURA_MAX_PAGES);

      setStepLabel("Iniciando análisis con IA…");
      const { data, error } = await monitored.invoke<{
        ok: boolean;
        cancelacionId?: string;
        code?: string;
        message?: string;
      }>("procesar-cancelacion", {
        cancelacionId,
        certificadoImagePaths,
        escrituraImagePaths,
      });

      if (error) {
        toast.error("No se pudo contactar al servidor", { description: error.message });
        setSaving(false);
        return;
      }

      if (data && data.ok === false) {
        const code = data.code ?? "internal";
        const message = data.message ?? "Error al procesar la cancelación";

        if (isCreditsBlockedError(null, data)) {
          emitCreditsBlocked({ source: "generate-document", message });
          setSaving(false);
          return;
        }

        switch (code) {
          case "ai_gateway_no_credits":
            toast.error("Error de Plataforma", {
              description: "El AI Gateway no cuenta con tokens globales disponibles. Contacte al administrador.",
            });
            break;
          case "credits_blocked":
            emitCreditsBlocked({ source: "generate-document", message });
            break;
          case "ai_gateway_rate_limit":
            toast.error("Demasiadas solicitudes", { description: message });
            break;
          case "pdf_too_large":
          case "ai_gateway_payload_too_large":
            toast.error("Documento demasiado pesado para la IA", { description: message });
            break;
          case "unsupported_image_format":
            toast.error("Formato de documento no soportado", { description: message });
            break;
          case "ai_gateway_bad_response":
            toast.error("La IA no devolvió datos válidos", { description: message });
            break;
          case "ai_gateway_error":
            toast.error("Error del servicio de IA", { description: message });
            break;
          case "credit_charge_error":
            toast.error("Error Técnico", {
              description: "No se pudo registrar el consumo de créditos. Contacte a soporte.",
            });
            break;
          default:
            toast.error("No se pudo procesar", { description: message });
            break;
        }
        setSaving(false);
        return;
      }

      toast.success("Procesamiento iniciado", {
        description: "El análisis se ejecuta en segundo plano. Esta página se actualizará automáticamente.",
      });
      await refreshCredits();
      queryClient.invalidateQueries({ queryKey: ["cancelaciones"] });
      navigate(`/cancelaciones/${cancelacionId}/validar`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("No se pudo procesar", { description: msg });
    } finally {
      setSaving(false);
      setStepLabel("");
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Button type="button" variant="ghost" size="sm" onClick={handleCancel} className="gap-2" disabled={saving}>
            <ArrowLeft className="h-4 w-4" />
            Volver a Cancelaciones
          </Button>
          <span className="text-sm text-muted-foreground">— Nueva Cancelación de Hipoteca</span>
        </div>
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Nueva cancelación de hipoteca</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Adjunta los documentos requeridos. La IA extraerá automáticamente los datos relevantes para construir el
            borrador del trámite.
          </p>
        </header>

        <div className="space-y-8">
          <section className="rounded-lg border border-border bg-background p-6">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={1} />
              <h2 className="text-base font-semibold">Banco acreedor</h2>
            </div>
            <Input value={BANCO_FIJO} disabled readOnly className="font-medium" aria-label="Banco acreedor" />
            <p className="mt-2 text-xs text-muted-foreground">
              Este módulo opera exclusivamente con {BANCO_FIJO}.
            </p>
          </section>

          <section className="rounded-lg border border-border bg-background p-6">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={2} />
              <h2 className="text-base font-semibold">Documentos de soporte</h2>
            </div>

            <div className="space-y-5">
              <FileDropzone
                label="Certificado de Tradición y Libertad (PDF)"
                file={certificado}
                onFile={setCertificado}
                disabled={saving}
              />
              <FileDropzone
                label={`Escritura Pública de Constitución de Hipoteca (PDF) — analizamos las primeras ${ESCRITURA_MAX_PAGES} páginas`}
                file={escritura}
                onFile={setEscritura}
                disabled={saving}
              />
            </div>
          </section>
        </div>
      </main>

      <div className="sticky bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-end gap-3 px-4 py-4 sm:px-6 lg:px-8">
          {saving && stepLabel && (
            <span className="mr-auto text-xs text-muted-foreground">{stepLabel}</span>
          )}
          <Button variant="ghost" onClick={handleCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="min-w-[180px] gap-2">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Procesando…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Procesar
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CancelacionNueva;
