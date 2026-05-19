import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, RefreshCw, FileText, FileSignature, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { monitored } from "@/services/monitoredClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const BUCKET_OUTPUT = "expediente-files";

type Data = {
  hipoteca_anterior: {
    numero_escritura_hipoteca: string;
    fecha_escritura_hipoteca: string;
    notaria_hipoteca: string;
    valor_hipoteca_original: string;
  };
  inmueble: {
    matricula_inmobiliaria: string;
    direccion_completa: string;
    ciudad: string;
  };
  partes: {
    deudor_nombre: string;
    deudor_identificacion: string;
    deudor_tipo_id: string;
    banco_acreedor: string;
    banco_nit: string;
  };
  analisis_legal: {
    aplica_ley_546: boolean;
    explicacion_ley: string;
  };
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-border bg-background p-5">
    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    <div className="space-y-4">{children}</div>
  </section>
);

const Field = ({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) => (
  <div className="space-y-1.5">
    <Label className="text-xs">{label}</Label>
    <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
  </div>
);

export const CancelacionValidar = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: row, isLoading } = useQuery({
    queryKey: ["cancelacion", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("cancelaciones").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
    refetchInterval: (q) => {
      const s = (q.state.data as { status?: string } | undefined)?.status;
      return s === "processing" || s === "draft" ? 3000 : false;
    },
  });

  const [data, setData] = useState<Data | null>(null);
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

  useEffect(() => {
    if (row?.data_final) setData(row.data_final as Data);
    else if (row?.data_ia) setData(row.data_ia as Data);
  }, [row]);

  // Debounced autosave to data_final
  useEffect(() => {
    if (!data || !id) return;
    const t = setTimeout(async () => {
      setSaving(true);
      const { error } = await supabase.from("cancelaciones").update({
        data_final: data,
        deudor_nombre: data.partes.deudor_nombre,
        deudor_cedula: data.partes.deudor_identificacion,
        matricula_inmobiliaria: data.inmueble.matricula_inmobiliaria,
        aplica_ley_546: data.analisis_legal.aplica_ley_546,
        explicacion_ley: data.analisis_legal.explicacion_ley,
      }).eq("id", id);
      setSaving(false);
      if (error) toast.error("No se pudo guardar", { description: error.message });
    }, 15000);
    return () => clearTimeout(t);
  }, [data, id]);

  const handleDownload = async (path: string | null, fallbackName: string) => {
    if (!path) {
      toast.error("Documento no disponible aún");
      return;
    }
    const { data: signed, error } = await supabase.storage.from(BUCKET_OUTPUT).createSignedUrl(path, 3600);
    if (error || !signed) {
      toast.error("No se pudo generar URL de descarga", { description: error?.message });
      return;
    }
    const a = document.createElement("a");
    a.href = signed.signedUrl;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleRegen = async () => {
    if (!id || !data) return;
    setRegen(true);
    // Persist latest edits first
    await supabase.from("cancelaciones").update({ data_final: data }).eq("id", id);
    const { error } = await monitored.invoke("procesar-cancelacion", { cancelacionId: id, regen: true });
    setRegen(false);
    if (error) {
      toast.error("No se pudo regenerar", { description: error.message });
      return;
    }
    toast.success("Documentos regenerados con tus datos editados");
    queryClient.invalidateQueries({ queryKey: ["cancelacion", id] });
  };

  const ready = useMemo(() => row?.status === "completed" && !!data, [row, data]);

  if (isLoading || !row) {
    return (
      <div className="min-h-screen bg-muted/30 p-8">
        <Skeleton className="h-10 w-64 mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (row.status === "processing") {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Procesando documentos con IA…</p>
        </div>
      </div>
    );
  }

  if (row.status === "error") {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-base font-semibold text-destructive">
            Falló el análisis de IA
          </p>
          <p className="mt-2 text-sm text-muted-foreground break-words">
            {row.error_message ?? "Ocurrió un error inesperado durante el procesamiento. Intenta nuevamente."}
          </p>
          <Button variant="default" onClick={() => navigate("/cancelaciones")} className="mt-6 gap-2">
            <ArrowLeft className="h-4 w-4" /> Volver a Cancelaciones
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top bar */}
      <div className="border-b border-border bg-background sticky top-0 z-10">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/cancelaciones")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Volver a Cancelaciones
          </Button>
          <span className="text-sm text-muted-foreground">— Validación de Cancelación</span>
          <div className="ml-auto flex items-center gap-2">
            {saving && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Guardando…
              </span>
            )}
            <Badge variant="outline" className="capitalize">{row.status}</Badge>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          {/* IZQUIERDA — Formulario */}
          <div className="space-y-5">
            {data && (
              <>
                <Section title="Hipoteca anterior">
                  <Field label="Número de escritura" value={data.hipoteca_anterior.numero_escritura_hipoteca}
                    onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, numero_escritura_hipoteca: v } })} />
                  <Field label="Fecha" value={data.hipoteca_anterior.fecha_escritura_hipoteca}
                    onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, fecha_escritura_hipoteca: v } })} />
                  <Field label="Notaría" value={data.hipoteca_anterior.notaria_hipoteca}
                    onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, notaria_hipoteca: v } })} />
                  <Field label="Valor original" value={data.hipoteca_anterior.valor_hipoteca_original}
                    onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, valor_hipoteca_original: v } })} />
                </Section>

                <Section title="Inmueble">
                  <Field label="Matrícula inmobiliaria" value={data.inmueble.matricula_inmobiliaria}
                    onChange={(v) => setData({ ...data, inmueble: { ...data.inmueble, matricula_inmobiliaria: v } })} />
                  <Field label="Dirección completa" value={data.inmueble.direccion_completa}
                    onChange={(v) => setData({ ...data, inmueble: { ...data.inmueble, direccion_completa: v } })} />
                  <Field label="Ciudad" value={data.inmueble.ciudad}
                    onChange={(v) => setData({ ...data, inmueble: { ...data.inmueble, ciudad: v } })} />
                </Section>

                <Section title="Partes">
                  <Field label="Nombre del deudor" value={data.partes.deudor_nombre}
                    onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_nombre: v } })} />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Tipo de identificación" value={data.partes.deudor_tipo_id}
                      onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_tipo_id: v } })} />
                    <Field label="Número de identificación" value={data.partes.deudor_identificacion}
                      onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_identificacion: v } })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Banco acreedor" value={data.partes.banco_acreedor} onChange={() => {}} disabled />
                    <Field label="NIT del banco" value={data.partes.banco_nit} onChange={() => {}} disabled />
                  </div>
                </Section>

                <Section title="Análisis legal">
                  <div className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">Aplica Ley 546 de 1999</p>
                      <p className="text-xs text-muted-foreground">Controla si se incluye la Cláusula Quinta</p>
                    </div>
                    <Switch checked={data.analisis_legal.aplica_ley_546}
                      onCheckedChange={(v) => setData({ ...data, analisis_legal: { ...data.analisis_legal, aplica_ley_546: v } })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Explicación</Label>
                    <Textarea rows={4} value={data.analisis_legal.explicacion_ley}
                      onChange={(e) => setData({ ...data, analisis_legal: { ...data.analisis_legal, explicacion_ley: e.target.value } })} />
                  </div>
                </Section>
              </>
            )}
          </div>

          {/* DERECHA — Descargas */}
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="rounded-lg border border-border bg-background p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Minuta de cancelación</h3>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">
                Documento de cancelación de hipoteca listo para firma.
              </p>
              <Button onClick={() => handleDownload(row.url_minuta_generada, "minuta-cancelacion.docx")} className="w-full gap-2" disabled={!ready}>
                <Download className="h-4 w-4" /> Descargar .docx
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-background p-5">
              <div className="mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Certificado bancario</h3>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">
                Certificado de paz y salvo de Davivienda.
              </p>
              <Button onClick={() => handleDownload(row.url_certificado_generado, "certificado-cancelacion.docx")} className="w-full gap-2" disabled={!ready}>
                <Download className="h-4 w-4" /> Descargar .docx
              </Button>
            </div>

            <div className="rounded-lg border border-dashed border-border bg-background p-5">
              <p className="mb-3 text-xs text-muted-foreground">
                Si editaste algún dato, regenera las minutas. Esta acción <strong>no consume créditos</strong>.
              </p>
              <Button variant="outline" onClick={handleRegen} disabled={regen || !ready} className="w-full gap-2">
                {regen ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Regenerar con datos editados
              </Button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default CancelacionValidar;
