import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCw, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { monitored } from "@/services/monitoredClient";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PdfViewerPane from "@/components/tramites/PdfViewerPane";

type NotariaEmisora = {
  notario_nombre?: string;
  notaria_emisora_titulo?: string;
  notaria_emisora_numero?: string;
  notaria_emisora_ciudad?: string;
  notaria_resolucion?: string;
  notaria_fecha_resolucion?: string;
  numero_escritura_nueva?: string;
  fecha_otorgamiento_nueva?: string;
  derechos_notariales?: string;
  superintendencia?: string;
  fondo_nacional?: string;
  iva?: string;
  valor_acto?: string;
};

type PoderBanco = {
  apoderado_nombre?: string;
  apoderado_cedula?: string;
  apoderado_escritura?: string;
  apoderado_fecha?: string;
  apoderado_notaria_poder?: string;
};

type Data = {
  hipoteca_anterior: {
    numero_escritura_hipoteca: string;
    fecha_escritura_hipoteca: string;
    notaria_hipoteca: string;
    valor_hipoteca_original: string;
  };
  inmueble: {
    matricula_inmobiliaria: string;
    direccion_completa?: string;
    ciudad: string;
    descripcion?: string;
    descripcion_predio?: string;
    nomenclatura_predio?: string;
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
  notaria_emisora?: NotariaEmisora;
  poder_banco?: PoderBanco;
};

const copyToClipboard = async (value: string, label: string) => {
  try {
    await navigator.clipboard.writeText(value ?? "");
    toast.success(`${label} copiado`);
  } catch {
    toast.error("No se pudo copiar");
  }
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-border bg-background p-4">
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    <div className="space-y-3">{children}</div>
  </section>
);

const Field = ({
  label,
  value,
  onChange,
  disabled,
  copyable = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  copyable?: boolean;
}) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}</Label>
    <div className="flex items-center gap-1.5">
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9 text-sm" />
      {copyable && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => copyToClipboard(value ?? "", label)}
          title={`Copiar ${label}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  </div>
);

export const CancelacionValidar = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refreshCredits } = useAuth();

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
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  const [activeDoc, setActiveDoc] = useState<"minuta" | "certificado">("minuta");
  const [viewerKey, setViewerKey] = useState(0);
  const creditsRefreshedRef = useRef(false);
  const initialHydrationRef = useRef(false);

  useEffect(() => {
    if (!row) return;
    const source = (row.data_final ?? row.data_ia) as Data | null;
    if (source && typeof source === "object" && !initialHydrationRef.current) {
      const ia = (row.data_ia ?? {}) as Partial<Data>;
      setData({
        ...source,
        notaria_emisora: source.notaria_emisora ?? {},
        poder_banco: source.poder_banco ?? ia.poder_banco ?? {},
      });
      initialHydrationRef.current = true;
      // Aviso semántico: valor del crédito no detectado por la IA.
      const valorCredito = (source.hipoteca_anterior?.valor_hipoteca_original ?? "").trim();
      if (!valorCredito) {
        toast.warning("Valor del crédito hipotecario no detectado", {
          description: "Verifícalo manualmente en la escritura antecedente antes de generar.",
          duration: 6000,
        });
      }
    }
  }, [row]);

  useEffect(() => {
    if (row?.status === "completed" && !creditsRefreshedRef.current) {
      creditsRefreshedRef.current = true;
      refreshCredits();
    }
  }, [row?.status, refreshCredits]);

  // Debounced autosave + regen (no bloqueante: solo refresca el panel derecho)
  useEffect(() => {
    if (!data || !id) return;
    if (row?.status === "processing" || row?.status === "error") return;
    if (!initialHydrationRef.current) return;

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
      if (error) {
        toast.error("No se pudo guardar", { description: error.message });
        return;
      }
      // Regen silencioso → solo el visor muestra loader
      setPreviewRefreshing(true);
      const { error: regenErr } = await monitored.invoke("procesar-cancelacion", { cancelacionId: id, regen: true });
      setPreviewRefreshing(false);
      if (!regenErr) {
        setViewerKey((k) => k + 1);
        queryClient.invalidateQueries({ queryKey: ["cancelacion", id] });
      }
    }, 15000);
    return () => clearTimeout(t);
  }, [data, id, row?.status, queryClient]);

  const handleManualRegen = async () => {
    if (!id || !data) return;
    setPreviewRefreshing(true);
    await supabase.from("cancelaciones").update({ data_final: data }).eq("id", id);
    const { error } = await monitored.invoke("procesar-cancelacion", { cancelacionId: id, regen: true });
    setPreviewRefreshing(false);
    if (error) {
      toast.error("No se pudo regenerar", { description: error.message });
      return;
    }
    toast.success("Documento actualizado");
    setViewerKey((k) => k + 1);
    queryClient.invalidateQueries({ queryKey: ["cancelacion", id] });
  };

  const activePath = useMemo(() => {
    if (!row) return null;
    return activeDoc === "minuta" ? row.url_minuta_generada : row.url_certificado_generado;
  }, [row, activeDoc]);

  if (isLoading || !row) {
    return (
      <div className="h-screen bg-muted/30 p-8 overflow-hidden">
        <Skeleton className="h-10 w-64 mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (row.status === "processing") {
    return (
      <div className="h-screen bg-muted/30 flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Procesando documentos con IA…</p>
        </div>
      </div>
    );
  }

  if (row.status === "error") {
    const rawErr = row.error_message ?? "";
    let humanErr = rawErr || "Ocurrió un error inesperado.";
    if (/unsupported image format/i.test(rawErr) || /ai gateway error 400/i.test(rawErr)) {
      humanErr = "El documento debe convertirse a imagen antes del análisis. Reintenta la carga.";
    } else if (/ai gateway error 413/i.test(rawErr) || /payload too large/i.test(rawErr)) {
      humanErr = "El documento supera el límite técnico de la IA (30 MB). Comprime el PDF antes de reintentar.";
    }
    return (
      <div className="h-screen bg-muted/30 flex items-center justify-center p-8 overflow-hidden">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-base font-semibold text-destructive">Falló el análisis de IA</p>
          <p className="mt-2 text-sm text-muted-foreground break-words">{humanErr}</p>
          <Button variant="default" onClick={() => navigate("/cancelaciones/nueva")} className="mt-6 gap-2">
            <ArrowLeft className="h-4 w-4" /> Regresar
          </Button>
        </div>
      </div>
    );
  }

  const ne: NotariaEmisora = data?.notaria_emisora ?? {};
  const setNE = (patch: Partial<NotariaEmisora>) =>
    data && setData({ ...data, notaria_emisora: { ...ne, ...patch } });

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-muted/30">
      {/* Top bar */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate("/cancelaciones")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
          <span className="text-sm text-muted-foreground">Validación de Cancelación</span>
          <Tabs value={activeDoc} onValueChange={(v) => { setActiveDoc(v as "minuta" | "certificado"); setViewerKey((k) => k + 1); }} className="ml-4">
            <TabsList className="h-8">
              <TabsTrigger value="minuta" className="text-xs">Minuta</TabsTrigger>
              <TabsTrigger value="certificado" className="text-xs">Certificado</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex items-center gap-2">
            {saving && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Guardando…
              </span>
            )}
            {previewRefreshing && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Actualizando vista…
              </span>
            )}
            <Button size="sm" variant="outline" onClick={handleManualRegen} disabled={previewRefreshing} className="gap-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Regenerar
            </Button>
            <Badge variant="outline" className="capitalize">{row.status}</Badge>
          </div>
        </div>
      </div>

      {/* Visor (izq) + Form (der) con scrolls independientes */}
      <div className="flex-1 min-h-0 overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_450px]">
        {/* Visor */}
        <div className="h-full overflow-hidden relative bg-slate-100 order-1">
          <PdfViewerPane
            key={`${activeDoc}-${viewerKey}`}
            filePath={activePath}
            refreshKey={`${activeDoc}-${viewerKey}`}
          />
          {previewRefreshing && (
            <div className="absolute inset-0 bg-background/40 backdrop-blur-sm flex items-center justify-center pointer-events-none z-20">
              <div className="rounded-md bg-background/95 px-4 py-2 shadow-lg border border-border flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs">Actualizando vista previa…</span>
              </div>
            </div>
          )}
        </div>

        {/* Form */}
        <div className="h-full overflow-y-auto p-4 space-y-3 bg-muted/20 border-l border-border order-2">
          {data && (
            <>
              <Section title="Hipoteca anterior">
                <Field label="Número de escritura" value={data.hipoteca_anterior.numero_escritura_hipoteca}
                  onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, numero_escritura_hipoteca: v } })} />
                <Field label="Fecha" value={data.hipoteca_anterior.fecha_escritura_hipoteca}
                  onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, fecha_escritura_hipoteca: v } })} />
                <Field label="Notaría" value={data.hipoteca_anterior.notaria_hipoteca}
                  onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, notaria_hipoteca: v } })} />
                <div className="space-y-1">
                  <Label className="text-xs">Valor del crédito hipotecario original</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={data.hipoteca_anterior.valor_hipoteca_original ?? ""}
                      onChange={(e) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, valor_hipoteca_original: e.target.value } })}
                      className={`h-9 text-sm ${!data.hipoteca_anterior.valor_hipoteca_original?.trim() ? "border-amber-500/60 focus-visible:ring-amber-500/40" : ""}`}
                      placeholder="CIENTO… DE PESOS ($000.000.000)"
                    />
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0"
                      onClick={() => copyToClipboard(data.hipoteca_anterior.valor_hipoteca_original ?? "", "Valor")}
                      title="Copiar valor">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Monto que el banco le prestó al deudor. Búscalo en la escritura antecedente: cláusula de constitución
                    de hipoteca, cláusula de pago de la compraventa ("el saldo se cubrirá con el producto del crédito…"),
                    o en la hoja de calificación. <span className="font-medium">No es el precio de venta ni el avalúo.</span>
                    Si la hipoteca es abierta, escribe exactamente <span className="font-mono">HIPOTECA DE CUANTÍA INDETERMINADA</span>.
                  </p>
                </div>
              </Section>

              <Section title="Inmueble">
                <Field label="Matrícula" value={data.inmueble.matricula_inmobiliaria}
                  onChange={(v) => setData({ ...data, inmueble: { ...data.inmueble, matricula_inmobiliaria: v } })} />
                <Field label="Ciudad" value={data.inmueble.ciudad}
                  onChange={(v) => setData({ ...data, inmueble: { ...data.inmueble, ciudad: v } })} />
                <div className="space-y-1">
                  <Label className="text-xs">Descripción Arquitectónica del Predio (Ubicación)</Label>
                  <Textarea rows={2} className="text-sm" value={data.inmueble.descripcion_predio ?? ""}
                    onChange={(e) => setData({ ...data, inmueble: { ...data.inmueble, descripcion_predio: e.target.value } })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nomenclatura Urbana (Dirección)</Label>
                  <Field label="" value={data.inmueble.nomenclatura_predio ?? ""}
                    onChange={(v) => setData({ ...data, inmueble: { ...data.inmueble, nomenclatura_predio: v } })} />
                  <p className="text-[11px] text-muted-foreground">
                    No incluyas el sufijo <span className="font-mono">(DIRECCION CATASTRAL)</span>; el sistema lo agrega automáticamente.
                  </p>
                </div>
              </Section>

              <Section title="Partes">
                <Field label="Deudor" value={data.partes.deudor_nombre}
                  onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_nombre: v } })} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Tipo ID" value={data.partes.deudor_tipo_id} copyable={false}
                    onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_tipo_id: v } })} />
                  <Field label="Número ID" value={data.partes.deudor_identificacion}
                    onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_identificacion: v } })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Banco" value={data.partes.banco_acreedor} onChange={() => {}} disabled />
                  <Field label="NIT" value={data.partes.banco_nit} onChange={() => {}} disabled />
                </div>
              </Section>

              {(() => {
                const pb: PoderBanco = data.poder_banco ?? {};
                const setPB = (patch: Partial<PoderBanco>) =>
                  setData({ ...data, poder_banco: { ...pb, ...patch } });
                const empty = !pb.apoderado_nombre && !pb.apoderado_cedula && !pb.apoderado_escritura
                  && !pb.apoderado_fecha && !pb.apoderado_notaria_poder;
                return (
                  <Section title="Apoderado del Banco (Poder General)">
                    {empty && (
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-500">
                        No se adjuntó Poder General. Los campos quedarán en blanco en el documento.
                      </p>
                    )}
                    <Field label="Nombre apoderado" value={pb.apoderado_nombre ?? ""}
                      onChange={(v) => setPB({ apoderado_nombre: v })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Cédula" value={pb.apoderado_cedula ?? ""}
                        onChange={(v) => setPB({ apoderado_cedula: v })} />
                      <Field label="N° escritura del poder" value={pb.apoderado_escritura ?? ""}
                        onChange={(v) => setPB({ apoderado_escritura: v })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Fecha del poder" value={pb.apoderado_fecha ?? ""}
                        onChange={(v) => setPB({ apoderado_fecha: v })} />
                      <Field label="Notaría del poder" value={pb.apoderado_notaria_poder ?? ""}
                        onChange={(v) => setPB({ apoderado_notaria_poder: v })} />
                    </div>
                  </Section>
                );
              })()}

              <Section title="Notario emisor">
                <Field label="Notario(a) nombre" value={ne.notario_nombre ?? ""} onChange={(v) => setNE({ notario_nombre: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Notaría N°" value={ne.notaria_emisora_numero ?? ""} onChange={(v) => setNE({ notaria_emisora_numero: v })} />
                  <Field label="Ciudad" value={ne.notaria_emisora_ciudad ?? ""} onChange={(v) => setNE({ notaria_emisora_ciudad: v })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Resolución" value={ne.notaria_resolucion ?? ""} onChange={(v) => setNE({ notaria_resolucion: v })} />
                  <Field label="Fecha resolución" value={ne.notaria_fecha_resolucion ?? ""} onChange={(v) => setNE({ notaria_fecha_resolucion: v })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="N° escritura nueva" value={ne.numero_escritura_nueva ?? ""} onChange={(v) => setNE({ numero_escritura_nueva: v })} />
                  <Field label="Fecha otorgamiento" value={ne.fecha_otorgamiento_nueva ?? ""} onChange={(v) => setNE({ fecha_otorgamiento_nueva: v })} />
                </div>
                <Field label="Título encabezado (NOTARIA …)" value={ne.notaria_emisora_titulo ?? ""} onChange={(v) => setNE({ notaria_emisora_titulo: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Derechos notariales $" value={ne.derechos_notariales ?? ""} onChange={(v) => setNE({ derechos_notariales: v })} copyable={false} />
                  <Field label="Superintendencia $" value={ne.superintendencia ?? ""} onChange={(v) => setNE({ superintendencia: v })} copyable={false} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Fondo nacional $" value={ne.fondo_nacional ?? ""} onChange={(v) => setNE({ fondo_nacional: v })} copyable={false} />
                  <Field label="IVA $" value={ne.iva ?? ""} onChange={(v) => setNE({ iva: v })} copyable={false} />
                </div>
                <Field label="Valor del acto $" value={ne.valor_acto ?? ""} onChange={(v) => setNE({ valor_acto: v })} />
              </Section>

              <Section title="Análisis legal">
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">Aplica Ley 546 de 1999</p>
                    <p className="text-xs text-muted-foreground">Incluye la Cláusula Quinta</p>
                  </div>
                  <Switch checked={data.analisis_legal.aplica_ley_546}
                    onCheckedChange={(v) => setData({ ...data, analisis_legal: { ...data.analisis_legal, aplica_ley_546: v } })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Explicación</Label>
                  <Textarea rows={3} className="text-sm" value={data.analisis_legal.explicacion_ley}
                    onChange={(e) => setData({ ...data, analisis_legal: { ...data.analisis_legal, explicacion_ley: e.target.value } })} />
                </div>
              </Section>
            </>
          )}
        </div>
      </div>

      {/* Estilos notariales para preservar sangría en cláusulas dentro del visor */}
      <style>{`
        .pdf-viewer-pane ol, .pdf-viewer-pane ul { padding-left: 2.25rem; margin: 0.5em 0; }
        .pdf-viewer-pane ol li, .pdf-viewer-pane ul li { margin-bottom: 0.35em; line-height: 1.5; }
        .pdf-viewer-pane p { margin: 0.4em 0; text-align: justify; line-height: 1.55; }
        .pdf-viewer-pane h1, .pdf-viewer-pane h2, .pdf-viewer-pane h3 { margin: 0.6em 0 0.3em; }
      `}</style>
    </div>
  );
};

export default CancelacionValidar;
