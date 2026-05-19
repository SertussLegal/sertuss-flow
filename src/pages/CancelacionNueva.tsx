import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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

  const handleSubmit = async () => {
    if (!activeOrgId) {
      toast.error("No hay organización activa");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("cancelaciones").insert({
      organization_id: activeOrgId,
      status: "draft",
    });
    setSaving(false);
    if (error) {
      toast.error("No se pudo crear la cancelación", { description: error.message });
      return;
    }
    toast.success("Cancelación creada en borrador", {
      description: `Banco: ${BANCO_FIJO}`,
    });
    queryClient.invalidateQueries({ queryKey: ["cancelaciones"] });
    navigate("/cancelaciones");
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
