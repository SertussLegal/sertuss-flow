import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, RefreshCw, AlertTriangle, Copy, Save, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
// Catálogo de campos obligatorios para cancelación Davivienda.
// Se importa para mantener el binding vivo (consumido por la prop `required`
// en los Fields críticos y reservado para futuras validaciones pre-generación).
import "@/lib/cancelacionCriticalFields";

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SegmentedChoice } from "@/components/shared/SegmentedChoice";
import { inferGeneroFromNombre } from "@/lib/genero";
import { useSaveStatus } from "@/contexts/SaveStatusContext";

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
  apoderado_fecha_dia?: string;
  apoderado_fecha_mes?: string;
  apoderado_fecha_anio?: string;
  apoderado_notaria_poder?: string;
  apoderado_genero?: "M" | "F" | "";
};

type Data = {
  hipoteca_anterior: {
    numero_escritura_hipoteca: string;
    fecha_escritura_hipoteca: string;
    notaria_hipoteca: string;
    valor_hipoteca_original: string;
    valor_hipoteca_es_indeterminada?: boolean;
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
    deudor_genero?: "M" | "F" | "";
    tratamiento_entidad?: "M" | "F" | "";
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

const MESES_NOMBRE = [
  "", "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];
const MES_LOOKUP: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09",
  octubre: "10", noviembre: "11", diciembre: "12",
};
// Extrae día/mes/año desde un string de fecha notarial libre.
// Acepta: "DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)" o "19/08/2025".
function parseFechaPartsClient(s: string): { dia: string; mes: string; anio: string } {
  if (!s) return { dia: "", mes: "", anio: "" };
  const diaP = (s.match(/\((\d{1,2})\)/)?.[1] ?? "").padStart(2, "0");
  let mes = "";
  const lower = s.toLowerCase();
  for (const [k, v] of Object.entries(MES_LOOKUP)) {
    if (lower.includes(k)) { mes = v; break; }
  }
  const anioMatch = s.match(/(19|20)\d{2}/);
  const anio = anioMatch ? anioMatch[0] : "";
  if (!diaP || !mes) {
    const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) return {
      dia: m[1].padStart(2, "0"),
      mes: m[2].padStart(2, "0"),
      anio: m[3].length === 2 ? `20${m[3]}` : m[3],
    };
  }
  return { dia: diaP, mes, anio };
}
// Recompone una fecha legible para el campo string a partir de atómicos.
// Formato simplificado: "DD DE <MES> DE AAAA". El usuario puede luego refinar
// a "DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)" si lo requiere.
function composeFechaFromAtoms(dia: string, mes: string, anio: string): string {
  if (!dia && !mes && !anio) return "";
  const mesIdx = parseInt(mes, 10);
  const mesNombre = mesIdx >= 1 && mesIdx <= 12 ? MESES_NOMBRE[mesIdx] : "";
  const parts: string[] = [];
  if (dia) parts.push(dia.padStart(2, "0"));
  if (mesNombre) parts.push("DE", mesNombre);
  if (anio) parts.push("DE", anio);
  return parts.join(" ");
}

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
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  copyable?: boolean;
  required?: boolean;
}) => {
  const isEmpty = !value || !value.trim() || value.trim() === "___________";
  const showMissing = required && isEmpty && !disabled;
  return (
    <div className="space-y-1">
      {label && (
        <Label className="text-xs flex items-center gap-1">
          {label}
          {required && <span className="text-destructive" aria-label="obligatorio">*</span>}
        </Label>
      )}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Input
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={`h-9 text-sm ${
              showMissing
                ? "border-destructive/70 focus-visible:ring-destructive/40 pr-8"
                : ""
            }`}
            aria-invalid={showMissing || undefined}
          />
          {showMissing && (
            <AlertCircle
              className="h-3.5 w-3.5 text-destructive absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden
            />
          )}
        </div>
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
      {showMissing && (
        <p className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> Campo obligatorio sin completar
        </p>
      )}
    </div>
  );
};

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
  const [isDirty, setIsDirty] = useState(false);
  const [previewRefreshing, setPreviewRefreshing] = useState(false);
  // Hallazgo 2: cuando un autosave silencioso guarda pero la regeneración
  // del documento falla, marcamos la vista como desactualizada en lugar de
  // mostrar el chip "Guardado ✓" mentiroso.
  const [previewStale, setPreviewStale] = useState(false);
  const [activeDoc, setActiveDoc] = useState<"minuta" | "certificado">("minuta");
  const [viewerKey, setViewerKey] = useState(0);
  const creditsRefreshedRef = useRef(false);
  const initialHydrationRef = useRef(false);
  const lastSavedSnapshotRef = useRef<string>("");
  // Hallazgo 7: evita que dos regeneraciones (manual + autosave silencioso)
  // se ejecuten en paralelo y crucen sus respuestas.
  const isRegenInFlightRef = useRef(false);
  // Eje A/Re-proceso v3: mutex anti doble-click + estado para UI del botón.
  const isReprocessingRef = useRef(false);
  const [reprocessing, setReprocessing] = useState(false);
  const { setStatus: setSaveStatus, flashSaved } = useSaveStatus();



  // Sincroniza chip global de guardado.
  // No forzamos `null` cuando ninguna condición aplica: eso permite que
  // `flashSaved(2000)` del autosave silencioso muestre el chip "Guardado"
  // sin ser pisado inmediatamente por este effect.
  useEffect(() => {
    if (saving) setSaveStatus("saving");
    else if (isDirty) setSaveStatus("dirty");
    else if (row?.status === "completed") setSaveStatus("saved");
  }, [saving, isDirty, row?.status, setSaveStatus]);

  // Limpia chip al salir de la página
  useEffect(() => {
    return () => setSaveStatus(null);
  }, [setSaveStatus]);

  useEffect(() => {
    if (!row) return;
    const source = (row.data_final ?? row.data_ia) as Data | null;
    if (source && typeof source === "object" && !initialHydrationRef.current) {
      const ia = (row.data_ia ?? {}) as Partial<Data>;
      // Merge selectivo campo-a-campo: la edición manual (source) prevalece;
      // la IA solo rellena huecos. Evita que un source.poder_banco parcial borre
      // los campos que sí extrajo la IA (incluidos los atómicos de fecha).
      const ia_pb: PoderBanco = (ia.poder_banco ?? {}) as PoderBanco;
      const src_pb: PoderBanco = (source.poder_banco ?? {}) as PoderBanco;
      const poderBanco: PoderBanco = {
        apoderado_nombre:        src_pb.apoderado_nombre        ?? ia_pb.apoderado_nombre,
        apoderado_cedula:        src_pb.apoderado_cedula        ?? ia_pb.apoderado_cedula,
        apoderado_escritura:     src_pb.apoderado_escritura     ?? ia_pb.apoderado_escritura,
        apoderado_fecha:         src_pb.apoderado_fecha         ?? ia_pb.apoderado_fecha,
        apoderado_fecha_dia:     src_pb.apoderado_fecha_dia     ?? ia_pb.apoderado_fecha_dia,
        apoderado_fecha_mes:     src_pb.apoderado_fecha_mes     ?? ia_pb.apoderado_fecha_mes,
        apoderado_fecha_anio:    src_pb.apoderado_fecha_anio    ?? ia_pb.apoderado_fecha_anio,
        apoderado_notaria_poder: src_pb.apoderado_notaria_poder ?? ia_pb.apoderado_notaria_poder,
        apoderado_genero:        src_pb.apoderado_genero        ?? ia_pb.apoderado_genero,
      };
      // Inferencia inicial de género (no sobrescribe si ya existe en data_final).
      const partes = {
        ...source.partes,
        deudor_genero: source.partes?.deudor_genero ?? inferGeneroFromNombre(source.partes?.deudor_nombre ?? ""),
        tratamiento_entidad: source.partes?.tratamiento_entidad ?? "",
      };
      const poderInferido = {
        ...poderBanco,
        apoderado_genero: poderBanco.apoderado_genero ?? inferGeneroFromNombre(poderBanco.apoderado_nombre ?? ""),
      };
      const hydrated = {
        ...source,
        partes,
        notaria_emisora: source.notaria_emisora ?? {},
        poder_banco: poderInferido,
      };
      setData(hydrated);
      lastSavedSnapshotRef.current = JSON.stringify(hydrated);
      setIsDirty(false);
      initialHydrationRef.current = true;
      // Aviso del valor del crédito ahora se muestra como banner inline
      // persistente dentro de la sección "Hipoteca anterior" (no toast).
    }
  }, [row]);

  // Detecta cambios manuales del usuario (post-hidratación) y marca dirty.
  useEffect(() => {
    if (!data || !initialHydrationRef.current) return;
    const snap = JSON.stringify(data);
    if (snap !== lastSavedSnapshotRef.current) {
      setIsDirty(true);
    }
  }, [data]);

  useEffect(() => {
    if (row?.status === "completed" && !creditsRefreshedRef.current) {
      creditsRefreshedRef.current = true;
      refreshCredits();
    }
  }, [row?.status, refreshCredits]);

  // Función central reutilizable: persiste data_final + regenera docx silenciosamente.
  // Limpia el flag dirty al terminar exitosamente.
  const persistData = useCallback(
    async (opts: { silent?: boolean } = {}): Promise<boolean> => {
      if (!id || !data) return false;
      // Hallazgo 7/8: mutex de regeneración. Si ya hay una en vuelo, no
      // disparamos otra (el autosave silencioso reintentará).
      if (isRegenInFlightRef.current) {
        if (opts.silent) return false;
      }
      setSaving(true);
      const snapshot = JSON.stringify(data);
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
        return false;
      }
      lastSavedSnapshotRef.current = snapshot;
      setIsDirty(false);
      // Regen silencioso con SSOT del frontend (manualOverrides).
      if (isRegenInFlightRef.current) {
        // Otro regen en curso: marcamos stale y dejamos que el siguiente
        // ciclo (manual o nuevo autosave) lo refresque.
        setPreviewStale(true);
        return true;
      }
      isRegenInFlightRef.current = true;
      setPreviewRefreshing(true);
      const { error: regenErr } = await monitored.invoke("procesar-cancelacion", {
        cancelacionId: id, regen: true, manualOverrides: data,
      });
      setPreviewRefreshing(false);
      isRegenInFlightRef.current = false;
      if (!regenErr) {
        setPreviewStale(false);
        setViewerKey((k) => k + 1);
        queryClient.invalidateQueries({ queryKey: ["cancelacion", id] });
        if (opts.silent) {
          // Confirmación pasiva: chip "Guardado" durante 2s.
          flashSaved(2000);
        } else {
          toast.success("Cambios guardados");
        }
      } else {
        // Hallazgo 2: NO mentir con "Guardado ✓" cuando la vista no se
        // actualizó. Mostrar chip persistente "vista desactualizada".
        setPreviewStale(true);
        if (!opts.silent) {
          toast.warning("Cambios guardados, pero la vista previa no se actualizó");
        }
      }
      return true;
    },
    [id, data, queryClient, flashSaved],
  );

  // Debounce inteligente: 3s si cambió poder_banco, 15s en otros casos.
  const prevPoderRef = useRef<string>("");
  useEffect(() => {
    if (!data || !id) return;
    if (row?.status === "processing" || row?.status === "error") return;
    if (!initialHydrationRef.current) return;

    const currentPoder = JSON.stringify(data.poder_banco ?? {});
    const poderChanged = prevPoderRef.current !== "" && prevPoderRef.current !== currentPoder;
    // Debounce ajustado: 3s para poder_banco (alta sensibilidad), 5s para el resto.
    const delay = poderChanged ? 3000 : 5000;

    const t = setTimeout(async () => {
      await persistData({ silent: true });
      prevPoderRef.current = currentPoder;
    }, delay);
    return () => clearTimeout(t);
  }, [data, id, row?.status, persistData]);

  const handleManualSave = () => {
    void persistData({ silent: false });
  };

  const handleManualRegen = async () => {
    if (!id || !data) return;
    // Hallazgo 7: mutex compartido con autosave silencioso.
    if (isRegenInFlightRef.current) return;
    // Si hay cambios pendientes, guárdalos primero (que también regenera).
    if (isDirty) {
      await persistData({ silent: true });
      return;
    }
    isRegenInFlightRef.current = true;
    setPreviewRefreshing(true);
    const { error } = await monitored.invoke("procesar-cancelacion", { cancelacionId: id, regen: true, manualOverrides: data });
    setPreviewRefreshing(false);
    isRegenInFlightRef.current = false;
    if (error) {
      setPreviewStale(true);
      toast.error("No se pudo regenerar", { description: error.message });
      return;
    }
    setPreviewStale(false);
    toast.success("Documento actualizado");
    setViewerKey((k) => k + 1);
    queryClient.invalidateQueries({ queryKey: ["cancelacion", id] });
  };

  // Re-procesar SOLO el Poder General con OCR dedicado. Idempotente
  // (la edge function limpia data_ia.poder_banco antes de re-inyectar).
  // No cobra créditos (unlock_expediente ya consumió los 2).
  const handleReprocessPoder = async () => {
    if (!id) return;
    if (isReprocessingRef.current) return;
    isReprocessingRef.current = true;
    setReprocessing(true);
    try {
      const { data: resp, error } = await monitored.invoke<{
        ok?: boolean; code?: string; message?: string; reprocessed?: boolean;
      }>("procesar-cancelacion", { cancelacionId: id, action: "reprocess_poder" });
      if (error) {
        toast.error("No se pudo re-procesar el Poder", { description: error.message });
        return;
      }
      if (resp && resp.ok === false) {
        toast.error("Re-procesamiento incompleto", { description: resp.message ?? "Intenta de nuevo." });
        return;
      }
      toast.success("Poder re-procesado");
      // Forzar re-hidratación desde data_final actualizada.
      initialHydrationRef.current = false;
      await queryClient.invalidateQueries({ queryKey: ["cancelacion", id] });
    } finally {
      isReprocessingRef.current = false;
      setReprocessing(false);
    }
  };




  // Aviso si el usuario cierra/recarga la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

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
    // Hallazgo 9: si lleva más de 5 minutos en "processing" sin actualizarse,
    // mostramos un banner accionable en vez del spinner infinito.
    const stalledMs = Date.now() - new Date(row.updated_at).getTime();
    const stalled = stalledMs > 5 * 60 * 1000;
    if (stalled) {
      return (
        <div className="h-screen bg-muted/30 flex items-center justify-center p-8 overflow-hidden">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
            </div>
            <p className="text-base font-semibold">Procesamiento demorado</p>
            <p className="mt-2 text-sm text-muted-foreground">
              El análisis lleva más de 5 minutos. Puede haber un problema con el servicio de IA.
              Vuelve al listado y reintenta más tarde o contacta a soporte.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="outline" onClick={() => navigate("/cancelaciones")} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Volver al listado
              </Button>
              <Button variant="default" onClick={() => queryClient.invalidateQueries({ queryKey: ["cancelacion", id] })} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Reintentar
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="h-screen bg-muted/30 flex items-center justify-center overflow-hidden">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Procesando documentos con IA…</p>
        </div>
      </div>
    );
  }

  // Hallazgo 5: borrador sin data_ia ⇒ el procesamiento no llegó a iniciarse
  // (típicamente por un fallo de red en CancelacionNueva). No dejar al usuario
  // varado: explicar y ofrecer acción concreta.
  if (row.status === "draft" && !row.data_ia) {
    return (
      <div className="h-screen bg-muted/30 flex items-center justify-center p-8 overflow-hidden">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
          </div>
          <p className="text-base font-semibold">Procesamiento no iniciado</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Este borrador quedó sin análisis. Lo más probable es que la conexión se interrumpió antes
            de enviar los documentos a la IA. Vuelve a iniciar la cancelación con los mismos archivos.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="outline" onClick={() => navigate("/cancelaciones")} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Volver al listado
            </Button>
            <Button variant="default" onClick={() => navigate("/cancelaciones/nueva")} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Reintentar carga
            </Button>
          </div>
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
            {previewRefreshing && (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Actualizando vista…
              </span>
            )}
            {previewStale && !previewRefreshing && (
              <span
                className="text-[11px] flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-amber-600 dark:text-amber-400"
                title="Los cambios se guardaron, pero el documento mostrado puede estar desactualizado. Pulsa Regenerar."
              >
                <AlertTriangle className="h-3 w-3" /> Vista desactualizada
              </span>
            )}
            <Button
              size="sm"
              variant={previewStale ? "default" : "outline"}
              onClick={handleManualRegen}
              disabled={previewRefreshing || saving}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerar
            </Button>
            <Button
              size="sm"
              onClick={handleManualSave}
              disabled={!isDirty || saving || previewRefreshing}
              className="gap-1.5 text-xs bg-notarial-gold text-slate-950 hover:bg-notarial-gold/90 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> Guardar cambios
            </Button>
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
            blockDownload={isDirty}
            onBlockedDownload={() => {
              toast.warning("Tienes cambios sin guardar", {
                description: "Guarda los cambios antes de descargar para que el documento incluya tus últimas ediciones.",
                action: {
                  label: "Guardar ahora",
                  onClick: () => handleManualSave(),
                },
                duration: 6000,
              });
            }}
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
                <Field label="Número de escritura" required value={data.hipoteca_anterior.numero_escritura_hipoteca}
                  onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, numero_escritura_hipoteca: v } })} />
                <Field label="Fecha" required value={data.hipoteca_anterior.fecha_escritura_hipoteca}
                  onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, fecha_escritura_hipoteca: v } })} />
                <Field label="Notaría" value={data.hipoteca_anterior.notaria_hipoteca}
                  onChange={(v) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, notaria_hipoteca: v } })} />
                {!data.hipoteca_anterior.valor_hipoteca_original?.trim() && (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-[12px] leading-snug"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold text-destructive">
                          Valor del crédito hipotecario no detectado
                        </p>
                        <p className="text-foreground/90">
                          La IA no logró identificar el monto. Verifícalo manualmente en la escritura
                          antecedente antes de generar el documento final. Esta alerta desaparecerá
                          al completar el campo.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    Valor del crédito hipotecario original
                    <span className="text-destructive" aria-label="obligatorio">*</span>
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <Input
                        value={data.hipoteca_anterior.valor_hipoteca_original ?? ""}
                        onChange={(e) => setData({ ...data, hipoteca_anterior: { ...data.hipoteca_anterior, valor_hipoteca_original: e.target.value } })}
                        className={`h-9 text-sm ${
                          !data.hipoteca_anterior.valor_hipoteca_original?.trim()
                            ? "border-destructive/70 focus-visible:ring-destructive/40 pr-8"
                            : ""
                        }`}
                        placeholder="CIENTO… DE PESOS ($000.000.000)"
                        aria-invalid={!data.hipoteca_anterior.valor_hipoteca_original?.trim() || undefined}
                      />
                      {!data.hipoteca_anterior.valor_hipoteca_original?.trim() && (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                      )}
                    </div>
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
                <Field label="Matrícula" required value={data.inmueble.matricula_inmobiliaria}
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
                <Field label="Deudor" required value={data.partes.deudor_nombre}
                  onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_nombre: v } })} />
                <SegmentedChoice
                  label="Género gramatical del deudor"
                  options={[
                    { value: "M", label: "Masculino" },
                    { value: "F", label: "Femenino" },
                  ]}
                  value={data.partes.deudor_genero ?? ""}
                  onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_genero: v as "M" | "F" | "" } })}
                  helper={`Define la concordancia: "el señor deudor identificado" vs "la señora deudora identificada". Vacío → "el(la) señor(a) deudor(a)".`}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Tipo ID" value={data.partes.deudor_tipo_id} copyable={false}
                    onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_tipo_id: v } })} />
                  <Field label="Número ID" required value={data.partes.deudor_identificacion}
                    onChange={(v) => setData({ ...data, partes: { ...data.partes, deudor_identificacion: v } })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Banco" value={data.partes.banco_acreedor} onChange={() => {}} disabled />
                  <Field label="NIT" value={data.partes.banco_nit} onChange={() => {}} disabled />
                </div>
                <SegmentedChoice
                  label="Tratamiento notarial del banco"
                  options={[
                    { value: "F", label: "La entidad" },
                    { value: "M", label: "El establecimiento bancario" },
                  ]}
                  value={data.partes.tratamiento_entidad ?? ""}
                  onChange={(v) => setData({ ...data, partes: { ...data.partes, tratamiento_entidad: v as "M" | "F" | "" } })}
                  helper={`Elige la fórmula de apertura. Vacío → "la entidad".`}
                />
              </Section>

              {(() => {
                const pb: PoderBanco = data.poder_banco ?? {};
                const setPB = (patch: Partial<PoderBanco>) =>
                  setData({ ...data, poder_banco: { ...pb, ...patch } });
                // Sincronización bidireccional fecha del poder:
                //  - Editar string compuesto → si parsea, poblar atómicos.
                //  - Editar atómicos → recomponer string para mantener un único SSOT.
                const setFechaString = (v: string) => {
                  const parsed = parseFechaPartsClient(v);
                  setPB({
                    apoderado_fecha: v,
                    apoderado_fecha_dia: parsed.dia || pb.apoderado_fecha_dia,
                    apoderado_fecha_mes: parsed.mes || pb.apoderado_fecha_mes,
                    apoderado_fecha_anio: parsed.anio || pb.apoderado_fecha_anio,
                  });
                };
                const setFechaAtom = (key: "dia" | "mes" | "anio", v: string) => {
                  const dia = key === "dia" ? v : (pb.apoderado_fecha_dia ?? "");
                  const mes = key === "mes" ? v : (pb.apoderado_fecha_mes ?? "");
                  const anio = key === "anio" ? v : (pb.apoderado_fecha_anio ?? "");
                  setPB({
                    apoderado_fecha_dia: dia,
                    apoderado_fecha_mes: mes,
                    apoderado_fecha_anio: anio,
                    apoderado_fecha: composeFechaFromAtoms(dia, mes, anio),
                  });
                };
                const empty = !pb.apoderado_nombre && !pb.apoderado_cedula && !pb.apoderado_escritura
                  && !pb.apoderado_fecha && !pb.apoderado_notaria_poder;
                // Eje A v3 — bandera de verdad emitida por el cliente al subir.
                const poderAdjuntado = (row as { poder_adjuntado?: boolean })?.poder_adjuntado === true;
                return (
                  <Section title="Apoderado del Banco (Poder General)">
                    {empty && !poderAdjuntado && (
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-500">
                        No se adjuntó Poder General. Los campos quedarán en blanco en el documento.
                      </p>
                    )}
                    {empty && poderAdjuntado && (
                      <div
                        role="alert"
                        className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-[12px] leading-snug"
                      >
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          <div className="space-y-2 flex-1">
                            <p className="font-semibold text-destructive">
                              Adjuntaste un Poder General pero la IA no logró capturar los datos
                            </p>
                            <p className="text-foreground/90">
                              Captúralos manualmente abajo o pulsa <span className="font-medium">Re-procesar poder</span> para que el sistema vuelva a intentarlo con un análisis dedicado.
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              onClick={handleReprocessPoder}
                              disabled={reprocessing}
                              className="gap-1.5 text-xs"
                            >
                              {reprocessing ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Procesando Poder...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Re-procesar poder
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    <Field label="Nombre apoderado" value={pb.apoderado_nombre ?? ""}
                      onChange={(v) => setPB({ apoderado_nombre: v })} />
                    <SegmentedChoice
                      label="Género del apoderado"
                      options={[
                        { value: "M", label: "Masculino" },
                        { value: "F", label: "Femenino" },
                      ]}
                      value={pb.apoderado_genero ?? ""}
                      onChange={(v) => setPB({ apoderado_genero: v as "M" | "F" | "" })}
                      helper={`"el señor apoderado identificado" vs "la señora apoderada identificada".`}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Cédula" value={pb.apoderado_cedula ?? ""}
                        onChange={(v) => setPB({ apoderado_cedula: v })} />
                      <Field label="N° escritura del poder" value={pb.apoderado_escritura ?? ""}
                        onChange={(v) => setPB({ apoderado_escritura: v })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Fecha del poder" value={pb.apoderado_fecha ?? ""}
                        onChange={setFechaString} />
                      <Field label="Notaría del poder" value={pb.apoderado_notaria_poder ?? ""}
                        onChange={(v) => setPB({ apoderado_notaria_poder: v })} />
                    </div>
                    <details className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
                      <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground select-none">
                        Editar día / mes / año (sincronizado)
                      </summary>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Día</Label>
                          <Input value={pb.apoderado_fecha_dia ?? ""} placeholder="DD" className="h-8 text-xs"
                            onChange={(e) => setFechaAtom("dia", e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Mes</Label>
                          <Input value={pb.apoderado_fecha_mes ?? ""} placeholder="MM" className="h-8 text-xs"
                            onChange={(e) => setFechaAtom("mes", e.target.value)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Año</Label>
                          <Input value={pb.apoderado_fecha_anio ?? ""} placeholder="AAAA" className="h-8 text-xs"
                            onChange={(e) => setFechaAtom("anio", e.target.value)} />
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Al editar aquí se recompone el campo "Fecha del poder" como
                        <span className="font-mono"> DD DE MES DE AAAA</span>. Refínalo con la doble expresión notarial si lo deseas.
                      </p>
                    </details>
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
