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

const BANCO_FIJO = "Banco Davivienda S.A.";

const StepNumber = ({ n }: { n: number }) => (
  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
    {n}
  </span>
);

export const CancelacionNueva = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeOrgId } = useAuth();

  const [certificado, setCertificado] = useState<File | null>(null);
  const [escritura, setEscritura] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const handleCancel = () => {
    if (saving) return;
    navigate("/cancelaciones");
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // strip "data:application/pdf;base64,"
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleSubmit = async () => {
    if (!activeOrgId) {
      toast.error("No hay organización activa");
      return;
    }
    if (!certificado || !escritura) {
      toast.error("Debes adjuntar ambos documentos");
      return;
    }
    setSaving(true);
    try {
      // 1) Crear el row en draft
      const { data: inserted, error: insErr } = await supabase
        .from("cancelaciones")
        .insert({ organization_id: activeOrgId, status: "draft" })
        .select("id")
        .single();
      if (insErr || !inserted) throw insErr ?? new Error("No se pudo crear");
      const cancelacionId = inserted.id;

      // 2) PDFs → base64
      const [certificadoBase64, escrituraBase64] = await Promise.all([
        fileToBase64(certificado),
        fileToBase64(escritura),
      ]);

      // 3) Invocar edge function
      const { data, error } = await monitored.invoke<{
        ok: boolean;
        cancelacionId?: string;
        code?: string;
        message?: string;
      }>("procesar-cancelacion", {
        cancelacionId,
        certificadoBase64,
        escrituraBase64,
      });

      if (error) {
        console.error("[CancelacionNueva] invoke error:", error);
        toast.error("No se pudo contactar al servidor", { description: error.message });
        setSaving(false);
        return;
      }

      // Business-error envelope: 200 OK con ok:false + code
      if (data && data.ok === false) {
        console.error("Error de Procesamiento Cancelación:", data.code, data.message);
        const code = data.code ?? "internal";
        const message = data.message ?? "Error al procesar la cancelación";

        // Safety-net: cualquier payload reconocido como "sin créditos internos"
        // dispara el modal global, igual que en Escrituras.
        if (isCreditsBlockedError(null, data)) {
          emitCreditsBlocked({ source: "generate-document", message });
          setSaving(false);
          return;
        }


        switch (code) {
          case "ai_gateway_no_credits":
            toast.error("Error de Plataforma", {
              description:
                "El AI Gateway no cuenta con tokens globales disponibles. Contacte al administrador del sistema.",
            });
            break;
          case "credits_blocked":
            emitCreditsBlocked({ source: "generate-document", message });
            break;
          case "ai_gateway_rate_limit":
            toast.error("Demasiadas solicitudes", { description: message });
            break;
          case "ai_gateway_bad_response":
            toast.error("La IA no devolvió datos válidos", { description: message });
            break;
          case "ai_gateway_error":
            toast.error("Error del servicio de IA", { description: message });
            break;
          default:
            toast.error("No se pudo procesar", { description: message });
            break;
        }
        setSaving(false);
        return;
      }

      toast.success("Cancelación procesada", { description: `Banco: ${BANCO_FIJO}` });
      queryClient.invalidateQueries({ queryKey: ["cancelaciones"] });
      navigate(`/cancelaciones/${cancelacionId}/validar`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("No se pudo procesar", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top bar */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="gap-2"
            disabled={saving}
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a Cancelaciones
          </Button>
          <span className="text-sm text-muted-foreground">— Nueva Cancelación de Hipoteca</span>
        </div>
      </div>

      {/* Main */}
      <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Nueva cancelación de hipoteca
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Adjunta los documentos requeridos. La IA extraerá automáticamente los datos
            relevantes para construir el borrador del trámite.
          </p>
        </header>

        <div className="space-y-8">
          {/* Sección 1: Banco */}
          <section className="rounded-lg border border-border bg-background p-6">
            <div className="mb-4 flex items-center gap-3">
              <StepNumber n={1} />
              <h2 className="text-base font-semibold">Banco acreedor</h2>
            </div>
            <Input
              value={BANCO_FIJO}
              disabled
              readOnly
              className="font-medium"
              aria-label="Banco acreedor"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Este módulo opera exclusivamente con {BANCO_FIJO}. Las plantillas y reglas
              de procesamiento están configuradas para esta entidad.
            </p>
          </section>

          {/* Sección 2: Documentos */}
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
                label="Escritura Pública de Constitución de Hipoteca (PDF)"
                file={escritura}
                onFile={setEscritura}
                disabled={saving}
              />
            </div>
          </section>
        </div>
      </main>

      {/* Footer fijo */}
      <div className="sticky bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-end gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <Button variant="ghost" onClick={handleCancel} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="min-w-[180px] gap-2">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando…
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
