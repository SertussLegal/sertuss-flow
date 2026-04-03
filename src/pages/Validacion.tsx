import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Eye, Cloud, CloudOff, Loader2, Coins, AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { validarConClaude, tieneErroresCriticos, contarPorNivel } from "@/services/validacionClaude";
import { toast as sonnerToast } from "sonner";
import PersonaForm from "@/components/tramites/PersonaForm";
import InmuebleForm from "@/components/tramites/InmuebleForm";
import type { ExtractedPersona, ExtractedDocumento } from "@/components/tramites/InmuebleForm";
import ActosForm from "@/components/tramites/ActosForm";
import DocxPreview from "@/components/tramites/DocxPreview";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import PreviewModal from "@/components/tramites/PreviewModal";
import { createEmptyPersona, createEmptyInmueble, createEmptyActos } from "@/lib/types";
import type { Persona, Inmueble, Actos, CustomVariable, SugerenciaIA, NivelConfianza } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { monitored } from "@/services/monitoredClient";
import { useAuth } from "@/contexts/AuthContext";
import { lookupBank } from "@/lib/bankDirectory";
import { reconcilePersonas, reconcileInmueble } from "@/lib/reconcileData";
import type { ReconcileAlert } from "@/lib/reconcileData";

// Maps template field names back to the form state they control
const FIELD_TO_INMUEBLE: Record<string, keyof Inmueble> = {
  matricula_inmobiliaria: "matricula_inmobiliaria",
  "inmueble.matricula": "matricula_inmobiliaria",
  identificador_predial: "identificador_predial",
  "inmueble.cedula_catastral": "identificador_predial",
  direccion_inmueble: "direccion",
  "inmueble.direccion": "direccion",
  municipio: "municipio",
  departamento: "departamento",
  area: "area",
  area_construida: "area_construida",
  area_privada: "area_privada",
  linderos: "linderos",
  "inmueble.linderos_especiales": "linderos",
  "inmueble.linderos_generales": "linderos",
  avaluo_catastral: "avaluo_catastral",
  codigo_orip: "codigo_orip",
  "inmueble.orip_ciudad": "codigo_orip",
  nupre: "nupre",
  "inmueble.nupre": "nupre",
  estrato: "estrato",
  "inmueble.estrato": "estrato",
};

const FIELD_TO_ACTOS: Record<string, keyof Actos> = {
  tipo_acto: "tipo_acto",
  valor_compraventa_letras: "valor_compraventa",
  "actos.cuantia_compraventa_letras": "valor_compraventa",
  "actos.cuantia_compraventa_numero": "valor_compraventa",
  entidad_bancaria: "entidad_bancaria",
  "actos.entidad_bancaria": "entidad_bancaria",
  valor_hipoteca_letras: "valor_hipoteca",
};

type SyncStatus = "saved" | "saving" | "unsaved" | "idle";

const Validacion = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const { user, profile, organization, credits, refreshCredits } = useAuth();
  const [isUnlocked, setIsUnlocked] = useState(false);

  const [tramiteId, setTramiteId] = useState<string | null>(id ?? null);
  const [vendedores, setVendedores] = useState<Persona[]>([createEmptyPersona()]);
  const [compradores, setCompradores] = useState<Persona[]>([createEmptyPersona()]);
  const [inmueble, setInmueble] = useState<Inmueble>(createEmptyInmueble());
  const [actos, setActos] = useState<Actos>(createEmptyActos());
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>([]);
  const [sugerenciasIA, setSugerenciasIA] = useState<SugerenciaIA[]>([]);
  const [textoFinalWord, setTextoFinalWord] = useState<string>("");
  const [generatingWord, setGeneratingWord] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [confianzaFields, setConfianzaFields] = useState<Map<string, NivelConfianza>>(new Map());
  const [notariaConfig, setNotariaConfig] = useState<{
    nombre_notaria: string; ciudad: string; notario_titular: string; estilo_linderos: string;
    numero_notaria: number | null; circulo: string; departamento: string; tipo_notario: string;
    nombre_notario: string; decreto_nombramiento: string;
  } | null>(null);
  const [extractedDocumento, setExtractedDocumento] = useState<{
    notaria_origen?: string; numero_escritura?: string; fecha_documento?: string;
    modo_adquisicion?: string; adquirido_de?: string;
    titulo_antecedente?: {
      tipo_documento?: string; numero_documento?: string; fecha_documento?: string;
      notaria_documento?: string; ciudad_documento?: string; adquirido_de?: string;
    };
  } | null>(null);
  const [extractedPredial, setExtractedPredial] = useState<{
    numero_recibo?: string; anio_gravable?: string; valor_pagado?: string; estrato?: string;
  } | null>(null);
  const [validando, setValidando] = useState(false);
  const [validacionDialogOpen, setValidacionDialogOpen] = useState(false);
  const [validacionResultado, setValidacionResultado] = useState<Awaited<ReturnType<typeof validarConClaude>> | null>(null);
  const isLoadingRef = useRef(false);
  const tramiteIdRef = useRef<string | null>(tramiteId);
  const dataIaSnapshot = useRef<Record<string, unknown> | null>(null);
  const manuallyEditedFieldsRef = useRef<Set<string>>(new Set());

  const handleConfianzaChange = useCallback((field: string, confianza: NivelConfianza) => {
    setConfianzaFields(prev => {
      const next = new Map(prev);
      next.set(field, confianza);
      return next;
    });
  }, []);

  // Count mandatory low-confidence fields
  const lowConfCount = Array.from(confianzaFields.values()).filter(c => c === "baja").length;

  // Keep ref in sync
  useEffect(() => { tramiteIdRef.current = tramiteId; }, [tramiteId]);

  useEffect(() => {
    if (!id) {
      navigate("/nuevo-tramite", { replace: true });
      return;
    }
    isLoadingRef.current = true;
    loadTramite(id).finally(() => { isLoadingRef.current = false; });
  }, [id]);

  // Mark dirty when data changes (skip during initial load)
  useEffect(() => {
    if (!isLoadingRef.current) {
      setIsDirty(true);
      setSyncStatus("unsaved");
    }
  }, [vendedores, compradores, inmueble, actos, customVariables]);

  // Auto-save debounce: 15 seconds
  useEffect(() => {
    if (!isDirty || !profile?.organization_id) return;
    const timer = setTimeout(() => {
      handleAutoSave();
    }, 15000);
    return () => clearTimeout(timer);
  }, [isDirty, vendedores, compradores, inmueble, actos, customVariables, profile?.organization_id]);

  // beforeunload: force save before leaving
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        handleAutoSave();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Force save before internal navigation
  const handleBack = useCallback(async () => {
    if (isDirty) {
      await handleAutoSave();
    }
    navigate("/dashboard");
  }, [isDirty, navigate]);

  const loadTramite = async (tid: string) => {
    const { data: t } = await supabase.from("tramites").select("*").eq("id", tid).single();
    if (!t) return;

    setIsUnlocked(!!(t as any).is_unlocked);

    const meta = (t as any).metadata;
    if (meta?.custom_variables) {
      setCustomVariables(meta.custom_variables);
    }
    if (meta?.sugerencias_ia) {
      setSugerenciasIA(meta.sugerencias_ia);
    }
    if (meta?.texto_final_word) {
      setTextoFinalWord(meta.texto_final_word);
    }
    // Restore confianza map
    if (meta?.confianza_map) {
      const map = new Map<string, NivelConfianza>();
      for (const [k, v] of Object.entries(meta.confianza_map)) {
        map.set(k, v as NivelConfianza);
      }
      setConfianzaFields(map);
    }

    // Restore AI snapshot from logs_extraccion for correction tracking
    const { data: logData } = await supabase
      .from("logs_extraccion")
      .select("data_ia")
      .eq("tramite_id", tid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (logData?.data_ia && !dataIaSnapshot.current) {
      dataIaSnapshot.current = logData.data_ia as Record<string, unknown>;
    }

    // Pre-populate from extracted data if no personas/inmuebles saved yet
    const { data: personas } = await supabase.from("personas").select("*").eq("tramite_id", tid);
    const { data: inm } = await supabase.from("inmuebles").select("*").eq("tramite_id", tid).maybeSingle();
    const { data: act } = await supabase.from("actos").select("*").eq("tramite_id", tid).maybeSingle();

    // ══════════════════════════════════════════════════════════════
    // ATOMIC HYDRATION PIPELINE — local variables, single setState
    // ══════════════════════════════════════════════════════════════
    const unwrap = (v: any): string => {
      if (!v) return "";
      if (typeof v === "string") return v;
      if (typeof v === "object" && "valor" in v) return String(v.valor || "");
      return String(v);
    };

    // ── 1. Build localVendedores / localCompradores ──
    let localVendedores: Persona[] = [createEmptyPersona()];
    let localCompradores: Persona[] = [createEmptyPersona()];

    if (personas && personas.length > 0) {
      const v = personas.filter((p: any) => p.rol === "vendedor").map((p: any) => ({ ...p } as Persona));
      const c = personas.filter((p: any) => p.rol === "comprador").map((p: any) => ({ ...p } as Persona));
      if (v.length) localVendedores = v;
      if (c.length) localCompradores = c;
    } else if (meta?.extracted_personas?.length) {
      const naturalPersons = meta.extracted_personas.filter((p: any) =>
        !p.tipo_identificacion || p.tipo_identificacion === "CC" || p.tipo_identificacion === "CE"
      );
      if (naturalPersons.length) {
        const vends = naturalPersons.filter((p: any) => p.rol === "vendedor");
        const comps = naturalPersons.filter((p: any) => p.rol === "comprador");
        if (vends.length) {
          localVendedores = vends.map((p: any) => ({
            ...createEmptyPersona(),
            nombre_completo: unwrap(p.nombre_completo),
            numero_cedula: unwrap(p.numero_identificacion),
            municipio_domicilio: unwrap(p.lugar_expedicion),
          }));
        }
        if (comps.length) {
          localCompradores = comps.map((p: any) => ({
            ...createEmptyPersona(),
            nombre_completo: unwrap(p.nombre_completo),
            numero_cedula: unwrap(p.numero_identificacion),
            municipio_domicilio: unwrap(p.lugar_expedicion),
          }));
        }
      }
    }

    // ── 2. Build localInmueble: MERGE DB + extracted_inmueble + extracted_predial ──
    let localInmueble: Inmueble = createEmptyInmueble();

    // Layer 1: DB row (user edits = highest priority)
    if (inm) {
      localInmueble = { ...localInmueble, ...inm } as Inmueble;
    }

    // Layer 2: metadata.extracted_inmueble fills EMPTY fields
    if (meta?.extracted_inmueble) {
      const ei = meta.extracted_inmueble;
      // OCR field name → DB column name mapping
      const ocrFieldMap: Record<string, string> = {
        chip_nupre: "nupre",
        chip: "nupre",
        cedula_catastral: "identificador_predial",
        numero_predial: "identificador_predial",
        codigo_orip: "codigo_orip",
        orip_ciudad: "codigo_orip",
        matricula_inmobiliaria: "matricula_inmobiliaria",
        matricula: "matricula_inmobiliaria",
        matricula_matriz: "matricula_matriz",
        direccion: "direccion",
        municipio: "municipio",
        departamento: "departamento",
        area: "area",
        area_construida: "area_construida",
        area_privada: "area_privada",
        linderos: "linderos",
        linderos_especiales: "linderos",
        linderos_generales: "linderos",
        avaluo_catastral: "avaluo_catastral",
        estrato: "estrato",
        nupre: "nupre",
        valorizacion: "valorizacion",
        escritura_ph: "escritura_ph",
        coeficiente: "coeficiente" as any,
        tipo_predio: "tipo_predio",
        es_propiedad_horizontal: "es_propiedad_horizontal",
      };
      for (const [ocrKey, val] of Object.entries(ei)) {
        const dbKey = ocrFieldMap[ocrKey] || ocrKey;
        const strVal = unwrap(val);
        if (strVal && dbKey in localInmueble) {
          const current = (localInmueble as any)[dbKey];
          // Only fill if DB field is empty
          if (!current || current === "" || current === false) {
            (localInmueble as any)[dbKey] = dbKey === "es_propiedad_horizontal" ? (strVal === "true" || strVal === "1" || /horizontal/i.test(strVal)) : strVal;
          }
        }
      }
      // Fallback: area_construida/area_privada → area
      if (!localInmueble.area && localInmueble.area_construida) localInmueble.area = localInmueble.area_construida;
      if (!localInmueble.area && localInmueble.area_privada) localInmueble.area = localInmueble.area_privada;
    }

    // Layer 3: metadata.extracted_predial fills remaining empty fields
    if (meta?.extracted_predial) {
      const ep = meta.extracted_predial;
      const predialMap: Record<string, string> = {
        avaluo_catastral: "avaluo_catastral",
        estrato: "estrato",
        area: "area",
        direccion: "direccion",
        nupre: "nupre",
        chip: "nupre",
        valorizacion: "valorizacion",
      };
      for (const [pKey, dbKey] of Object.entries(predialMap)) {
        const strVal = unwrap(ep[pKey]);
        if (strVal && dbKey in localInmueble) {
          const current = (localInmueble as any)[dbKey];
          if (!current || current === "") {
            (localInmueble as any)[dbKey] = strVal;
          }
        }
      }
    }

    // ── 3. Build localActos ──
    let localActos: Actos = createEmptyActos();
    if (act) {
      localActos = act as any;
    } else if (meta?.extracted_actos) {
      const ea = meta.extracted_actos;
      const unwrapBoolVal = (v: any): boolean => {
        if (v == null) return false;
        if (typeof v === "boolean") return v;
        if (typeof v === "object" && "valor" in v) return !!v.valor;
        return false;
      };
      const cleanCurr = (val: string): string => {
        if (!val) return "";
        return val.replace(/[$.\s]/g, "").replace(/,\d{2}$/, "").replace(/,/g, "");
      };
      const tipoActo = unwrap(ea.tipo_acto_principal);
      const esHipoteca = unwrapBoolVal(ea.es_hipoteca);
      const entidad = unwrap(ea.entidad_bancaria);
      const entidadNit = unwrap(ea.entidad_nit);
      const bankInfo = entidad ? lookupBank(entidad) : null;
      localActos = {
        ...localActos,
        ...(tipoActo ? { tipo_acto: esHipoteca && !tipoActo.toLowerCase().includes("hipoteca") ? `${tipoActo} con Hipoteca` : tipoActo } : {}),
        ...(unwrap(ea.valor_compraventa) ? { valor_compraventa: cleanCurr(unwrap(ea.valor_compraventa)) } : {}),
        ...(esHipoteca ? { es_hipoteca: true } : {}),
        ...(unwrap(ea.valor_hipoteca) ? { valor_hipoteca: cleanCurr(unwrap(ea.valor_hipoteca)) } : {}),
        ...(entidad ? { entidad_bancaria: entidad } : {}),
        ...(entidadNit ? { entidad_nit: entidadNit } : bankInfo ? { entidad_nit: bankInfo.nit } : {}),
        ...(bankInfo && !unwrap(ea.entidad_domicilio) ? { entidad_domicilio: bankInfo.domicilio } : {}),
        ...(unwrapBoolVal(ea.afectacion_vivienda_familiar) ? { afectacion_vivienda_familiar: true } : {}),
      };
    }

    // ── 4. Load notaria config ──
    if (t.organization_id) {
      const [{ data: ns }, { data: cn }] = await Promise.all([
        supabase.from("notaria_styles").select("*").eq("organization_id", t.organization_id).maybeSingle(),
        supabase.from("configuracion_notaria").select("*").eq("organization_id", t.organization_id).maybeSingle(),
      ]);
      if (ns || cn) {
        setNotariaConfig({
          nombre_notaria: ns?.nombre_notaria || "",
          ciudad: ns?.ciudad || "",
          notario_titular: ns?.notario_titular || "",
          estilo_linderos: ns?.estilo_linderos || "",
          numero_notaria: cn?.numero_notaria ?? null,
          circulo: cn?.circulo || "",
          departamento: cn?.departamento || "",
          tipo_notario: cn?.tipo_notario || "",
          nombre_notario: cn?.nombre_notario || "",
          decreto_nombramiento: cn?.decreto_nombramiento || "",
        });
      }
    }

    // ── 5. Load extracted_documento ──
    if (meta?.extracted_documento) {
      const doc = meta.extracted_documento;
      if (meta?.extracted_titulo_antecedente && !doc.titulo_antecedente) {
        doc.titulo_antecedente = meta.extracted_titulo_antecedente;
      }
      setExtractedDocumento(doc);
    }

    // ── 6. Load extracted_predial for preview ──
    let localExtractedPredial: any = null;
    if (meta?.extracted_predial) {
      localExtractedPredial = meta.extracted_predial;
    } else if (meta?.extracted_inmueble) {
      const ei = meta.extracted_inmueble;
      const predialFields: Record<string, string> = {};
      const predialKeys = ["numero_recibo", "anio_gravable", "valor_pagado", "estrato", "nupre", "valorizacion"];
      for (const key of predialKeys) {
        if (ei[key]) {
          predialFields[key] = typeof ei[key] === "object" && "valor" in ei[key] ? ei[key].valor : String(ei[key]);
        }
      }
      if (Object.keys(predialFields).length > 0) {
        localExtractedPredial = predialFields;
      }
    }
    setExtractedPredial(localExtractedPredial);

    // ── 7. RECONCILIATION on local variables (no stale state!) ──
    const cedulasDetail = meta?.extracted_cedulas_detail || meta?.extracted_personas || [];
    const escrituraComparecientes = meta?.extracted_escritura_comparecientes || [];
    const dirtyFields = manuallyEditedFieldsRef.current;

    if (cedulasDetail.length > 0 || escrituraComparecientes.length > 0) {
      const hasRealVendedores = localVendedores.length > 0 && localVendedores[0].nombre_completo;
      const hasRealCompradores = localCompradores.length > 0 && localCompradores[0].nombre_completo;

      if (hasRealVendedores) {
        const reconV = reconcilePersonas(localVendedores, cedulasDetail, escrituraComparecientes, dirtyFields);
        localVendedores = reconV.updated;
        for (const alert of reconV.alerts) {
          sonnerToast.warning(alert.mensaje, { duration: 8000 });
        }
      }
      if (hasRealCompradores) {
        const reconC = reconcilePersonas(localCompradores, cedulasDetail, escrituraComparecientes, dirtyFields);
        localCompradores = reconC.updated;
        for (const alert of reconC.alerts) {
          sonnerToast.warning(alert.mensaje, { duration: 8000 });
        }
      }
    }

    // Reconcile inmueble with predial
    localInmueble = reconcileInmueble(localInmueble, meta?.extracted_predial, dirtyFields);

    // ── 8. SINGLE setState — UI renders once with complete data ──
    setVendedores(localVendedores);
    setCompradores(localCompradores);
    setInmueble(localInmueble);
    setActos(localActos);

    setSyncStatus("saved");
    setIsDirty(false);
  };

  // (Predial sync is now handled atomically inside loadTramite pipeline)

  // Scroll-to-field handler: activates the correct tab and scrolls to the input
  const onScrollToField = useCallback((field: string) => {
    const tabsEl = document.querySelector('[role="tablist"]');
    if (!tabsEl) return;

    let targetTab = "inmueble";
    if (field.startsWith("actos.") || field.startsWith("apoderado_banco.") || FIELD_TO_ACTOS[field]) {
      targetTab = "actos";
    } else if (field.includes("vendedor") || field.includes("compareciente")) {
      targetTab = "vendedores";
    } else if (field.includes("comprador")) {
      targetTab = "compradores";
    }

    const trigger = tabsEl.querySelector(`[data-value="${targetTab}"]`) as HTMLElement;
    if (trigger) trigger.click();

    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-field-input="${field}"]`) as HTMLElement;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
        el.style.outline = "2px solid hsl(var(--primary))";
        el.style.outlineOffset = "2px";
        setTimeout(() => { el.style.outline = ""; el.style.outlineOffset = ""; }, 2000);
      }
    });
  }, []);

  const calculateProgress = () => {
    const personaFields: (keyof Persona)[] = ["nombre_completo", "numero_cedula", "estado_civil", "direccion", "municipio_domicilio"];
    const inmuebleFields: (keyof Inmueble)[] = ["matricula_inmobiliaria", "identificador_predial", "departamento", "municipio", "direccion", "area", "linderos", "avaluo_catastral"];
    const actosBaseFields: (keyof Actos)[] = ["tipo_acto", "valor_compraventa"];
    const actosHipotecaFields: (keyof Actos)[] = ["entidad_bancaria", "valor_hipoteca", "apoderado_nombre"];

    const allPersonas = [...vendedores, ...compradores];
    let filled = 0;
    let total = (personaFields.length * allPersonas.length) + inmuebleFields.length + actosBaseFields.length;

    allPersonas.forEach(p => {
      personaFields.forEach(f => { if (typeof p[f] === "string" && (p[f] as string).trim()) filled++; });
    });
    inmuebleFields.forEach(f => { if (typeof inmueble[f] === "string" && (inmueble[f] as string).trim()) filled++; });
    actosBaseFields.forEach(f => { if (typeof actos[f] === "string" && (actos[f] as string).trim()) filled++; });

    if (actos.es_hipoteca) {
      total += actosHipotecaFields.length;
      actosHipotecaFields.forEach(f => { if (typeof actos[f] === "string" && (actos[f] as string).trim()) filled++; });
    }

    return total > 0 ? Math.round((filled / total) * 100) : 0;
  };

  const handleAutoSave = async () => {
    if (!profile?.organization_id) return;
    setSyncStatus("saving");
    try {
      let tid = tramiteIdRef.current;
      const formMetadata = {
        last_saved: new Date().toISOString(),
        custom_variables: customVariables.map(cv => ({ ...cv })),
        progress: calculateProgress(),
        confianza_map: Object.fromEntries(confianzaFields),
        ...(sugerenciasIA.length > 0 ? { sugerencias_ia: sugerenciasIA } : {}),
        ...(textoFinalWord ? { texto_final_word: textoFinalWord } : {}),
      } as Record<string, unknown>;

      if (!tid) {
        // No tramite ID — don't create orphan drafts silently
        setSyncStatus("unsaved");
        return;
      } else {
        // Read-then-merge: preserve extracted_* keys from OCR
        const { data: existing } = await supabase.from("tramites").select("metadata").eq("id", tid).single();
        const existingMeta = (existing?.metadata as Record<string, unknown>) || {};
        const preservedKeys = ["extracted_inmueble", "extracted_documento", "extracted_predial", "extracted_personas", "extracted_actos", "extracted_titulo_antecedente", "extracted_escritura_comparecientes", "extracted_cedulas_detail"];
        const merged: Record<string, unknown> = { ...formMetadata };
        for (const key of preservedKeys) {
          if (existingMeta[key] && !merged[key]) {
            merged[key] = existingMeta[key];
          }
        }
        await supabase.from("tramites").update({
          updated_at: new Date().toISOString(),
          metadata: merged as any,
          tipo: actos.tipo_acto || "Compraventa",
        }).eq("id", tid);
      }

      // Upsert related data: delete and re-insert
      await supabase.from("personas").delete().eq("tramite_id", tid!);
      await supabase.from("inmuebles").delete().eq("tramite_id", tid!);
      await supabase.from("actos").delete().eq("tramite_id", tid!);

      const personasToInsert = [
        ...vendedores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "vendedor" as any })),
        ...compradores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "comprador" as any })),
      ];
      if (personasToInsert.length) {
        await supabase.from("personas").insert(personasToInsert);
      }
      await supabase.from("inmuebles").insert({ ...inmuebleToRow(inmueble), tramite_id: tid! });
      await supabase.from("actos").insert({ ...actosToRow(actos), tramite_id: tid! });

      setIsDirty(false);
      setSyncStatus("saved");
    } catch {
      setSyncStatus("unsaved");
    }
  };

  // Bidirectional sync: preview → form data
  const handleFieldEdit = useCallback((field: string, value: string) => {
    // Track manually edited fields to prevent OCR overwrite
    manuallyEditedFieldsRef.current.add(field);

    if (field.startsWith("__custom__")) {
      const cvId = field.replace("__custom__", "");
      setCustomVariables((prev) =>
        prev.map((cv) => (cv.id === cvId ? { ...cv, value } : cv))
      );
      return;
    }
    if (FIELD_TO_INMUEBLE[field]) {
      const inmuebleKey = FIELD_TO_INMUEBLE[field];
      manuallyEditedFieldsRef.current.add(inmuebleKey);
      setInmueble((prev) => ({ ...prev, [inmuebleKey]: value }));
      return;
    }
    if (FIELD_TO_ACTOS[field]) {
      const actosKey = FIELD_TO_ACTOS[field];
      manuallyEditedFieldsRef.current.add(actosKey);
      setActos((prev) => ({ ...prev, [actosKey]: value }));
      return;
    }
  }, []);

  const handlePersonasExtracted = useCallback((personas: ExtractedPersona[]) => {
    if (!personas.length) return;

    // Auto-fill vendedores with extracted personas that have CC (natural persons)
    const naturalPersons = personas.filter(p =>
      !p.tipo_identificacion || p.tipo_identificacion === "CC" || p.tipo_identificacion === "CEDULA DE CIUDADANIA" || p.tipo_identificacion === "CE"
    );

    if (naturalPersons.length === 0) return;

    setVendedores(prev => {
      const updated = [...prev];
      let insertIndex = 0;

      for (const extracted of naturalPersons) {
        // Check if this person already exists
        const alreadyExists = updated.some(v =>
          v.numero_cedula === extracted.numero_identificacion && extracted.numero_identificacion
        );
        if (alreadyExists) continue;

        // Find first empty slot or add new
        const emptySlot = updated.findIndex((v, i) => i >= insertIndex && !v.nombre_completo && !v.numero_cedula);
        const newPersona = {
          ...createEmptyPersona(),
          nombre_completo: extracted.nombre_completo || "",
          numero_cedula: extracted.numero_identificacion || "",
          municipio_domicilio: extracted.lugar_expedicion || "",
        };

        if (emptySlot >= 0) {
          updated[emptySlot] = newPersona;
          insertIndex = emptySlot + 1;
        } else {
          updated.push(newPersona);
          insertIndex = updated.length;
        }
      }

      return updated;
    });

    toast({
      title: "Personas extraídas",
      description: `${naturalPersons.length} persona(s) detectada(s) en el certificado.`,
    });
  }, [toast]);

  const handleDocumentoExtracted = useCallback((documento: ExtractedDocumento & { comparecientes?: any[] }) => {
    setExtractedDocumento(documento);
    // Persist to metadata immediately (non-destructive merge)
    const tid = tramiteIdRef.current;
    if (tid) {
      supabase.from("tramites").select("metadata").eq("id", tid).single()
        .then(({ data }) => {
          const merged: Record<string, any> = { ...((data?.metadata as any) || {}), extracted_documento: documento };
          // Also persist titulo_antecedente separately for easy access
          if (documento.titulo_antecedente) {
            merged.extracted_titulo_antecedente = documento.titulo_antecedente;
          }
          // Persist escritura comparecientes for reconciliation
          if (documento.comparecientes && documento.comparecientes.length > 0) {
            merged.extracted_escritura_comparecientes = documento.comparecientes;
            // Run reconciliation with FUNCTIONAL UPDATES to avoid stale state
            const dirtyFields = manuallyEditedFieldsRef.current;
            // Also gather cedulasDetail from existing metadata
            const cedulasDetail = (data?.metadata as any)?.extracted_cedulas_detail || (data?.metadata as any)?.extracted_personas || [];
            setVendedores(prev => {
              const recon = reconcilePersonas(prev, cedulasDetail, documento.comparecientes!, dirtyFields);
              for (const alert of recon.alerts) {
                sonnerToast.warning(alert.mensaje, { duration: 8000 });
              }
              return recon.updated;
            });
            setCompradores(prev => {
              const recon = reconcilePersonas(prev, cedulasDetail, documento.comparecientes!, dirtyFields);
              for (const alert of recon.alerts) {
                sonnerToast.warning(alert.mensaje, { duration: 8000 });
              }
              return recon.updated;
            });
          }
          supabase.from("tramites").update({ metadata: merged as any }).eq("id", tid);
        });
    }
  }, []);

  // Currency normalization helper
  const cleanCurrency = (val: string): string => {
    if (!val) return "";
    return val.replace(/[$.\s]/g, "").replace(/,\d{2}$/, "").replace(/,/g, "");
  };

  // Handle actos extracted from certificado de tradición OCR
  const handleActosExtracted = useCallback((extracted: Record<string, any>) => {
    setActos(prev => {
      const updates: Partial<Actos> = {};
      const isDirty = (field: string) => manuallyEditedFieldsRef.current.has(field);

      // Unwrap confidence wrappers
      const unwrap = (v: any): string => {
        if (!v) return "";
        if (typeof v === "string") return v;
        if (typeof v === "object" && "valor" in v) return String(v.valor || "");
        return String(v);
      };
      const unwrapBool = (v: any): boolean => {
        if (v == null) return false;
        if (typeof v === "boolean") return v;
        if (typeof v === "object" && "valor" in v) return !!v.valor;
        return false;
      };

      const tipoActo = unwrap(extracted.tipo_acto_principal);
      if (tipoActo && !isDirty("tipo_acto") && !prev.tipo_acto) {
        // Compose tipo_acto intelligently
        const esHipoteca = unwrapBool(extracted.es_hipoteca);
        if (esHipoteca && !tipoActo.toLowerCase().includes("hipoteca")) {
          updates.tipo_acto = `${tipoActo} con Hipoteca`;
        } else {
          updates.tipo_acto = tipoActo;
        }
      }

      const valorCV = cleanCurrency(unwrap(extracted.valor_compraventa));
      if (valorCV && !isDirty("valor_compraventa") && !prev.valor_compraventa) {
        updates.valor_compraventa = valorCV;
      }

      const esHipoteca = unwrapBool(extracted.es_hipoteca);
      if (esHipoteca && !isDirty("es_hipoteca") && !prev.es_hipoteca) {
        updates.es_hipoteca = true;
      }

      const valorHip = cleanCurrency(unwrap(extracted.valor_hipoteca));
      if (valorHip && !isDirty("valor_hipoteca") && !prev.valor_hipoteca) {
        updates.valor_hipoteca = valorHip;
      }

      const entidad = unwrap(extracted.entidad_bancaria);
      if (entidad && !isDirty("entidad_bancaria") && !prev.entidad_bancaria) {
        updates.entidad_bancaria = entidad;
        // Bank directory enrichment
        const bankInfo = lookupBank(entidad);
        if (bankInfo) {
          if (!isDirty("entidad_nit") && !prev.entidad_nit) {
            updates.entidad_nit = bankInfo.nit;
          }
          if (!isDirty("entidad_domicilio") && !prev.entidad_domicilio) {
            updates.entidad_domicilio = bankInfo.domicilio;
          }
        }
      }

      const entidadNit = unwrap(extracted.entidad_nit);
      if (entidadNit && !isDirty("entidad_nit") && !prev.entidad_nit && !updates.entidad_nit) {
        updates.entidad_nit = entidadNit;
      }

      const afectacion = unwrapBool(extracted.afectacion_vivienda_familiar);
      if (afectacion && !isDirty("afectacion_vivienda_familiar")) {
        updates.afectacion_vivienda_familiar = true;
      }

      return Object.keys(updates).length ? { ...prev, ...updates } : prev;
    });

    // Persist extracted_actos to metadata
    const tid = tramiteIdRef.current;
    if (tid) {
      supabase.from("tramites").select("metadata").eq("id", tid).single()
        .then(({ data }) => {
          const merged = { ...((data?.metadata as any) || {}), extracted_actos: extracted };
          supabase.from("tramites").update({ metadata: merged as any }).eq("id", tid);
        });
    }
  }, []);

  const handlePredialExtracted = useCallback((data: { numero_recibo?: string; anio_gravable?: string; valor_pagado?: string; estrato?: string }) => {
    setExtractedPredial(data);
    // Persist to metadata immediately (non-destructive merge)
    const tid = tramiteIdRef.current;
    if (tid) {
      supabase.from("tramites").select("metadata").eq("id", tid).single()
        .then(({ data: existing }) => {
          const merged = { ...((existing?.metadata as any) || {}), extracted_predial: data };
          supabase.from("tramites").update({ metadata: merged as any }).eq("id", tid);
        });
    }
  }, []);

  const handleCreateCustomVariable = useCallback((originalText: string, variableName: string) => {
    const newVar: CustomVariable = {
      id: crypto.randomUUID(),
      originalText,
      variableName,
      value: "",
    };
    setCustomVariables((prev) => [...prev, newVar]);
    toast({
      title: "Variable creada",
      description: `"${originalText.slice(0, 30)}${originalText.length > 30 ? "…" : ""}" → {${variableName}}`,
    });
  }, [toast]);

  // Reverse sync: accept AI suggestion → update form + force save
  const handleSugerenciaAccepted = useCallback(async (idx: number, textoSugerido: string) => {
    const sug = sugerenciasIA[idx];
    if (!sug) return;

    // If campo is specified, update form state
    if (sug.campo) {
      handleFieldEdit(sug.campo, textoSugerido);
    }

    // Update texto_final_word: replace original with suggested
    if (textoFinalWord) {
      setTextoFinalWord(prev => prev.replace(sug.texto_original, textoSugerido));
    }

    // Remove accepted suggestion
    setSugerenciasIA(prev => prev.filter((_, i) => i !== idx));

    // Force immediate save
    setIsDirty(true);
    setTimeout(() => handleAutoSave(), 100);
  }, [sugerenciasIA, textoFinalWord, handleFieldEdit, handleAutoSave]);

  // Build correction diff between AI snapshot and current form state
  const buildCorrecciones = (
    dataIa: Record<string, unknown>,
    currentData: { vendedores: Persona[]; compradores: Persona[]; inmueble: Inmueble; actos: Actos }
  ): Array<{ campo: string; valor_ia: string; valor_final: string }> => {
    const correcciones: Array<{ campo: string; valor_ia: string; valor_final: string }> = [];

    // Compare inmueble fields
    const inmuebleKeys: (keyof Inmueble)[] = [
      "matricula_inmobiliaria", "identificador_predial", "departamento", "municipio",
      "direccion", "area", "area_construida", "area_privada", "linderos",
      "avaluo_catastral", "codigo_orip", "tipo_predio",
    ];
    for (const key of inmuebleKeys) {
      const iaVal = String((dataIa as any)?.[key] ?? (dataIa as any)?.inmueble?.[key] ?? "");
      const curVal = String(currentData.inmueble[key] ?? "");
      if (iaVal !== curVal && (iaVal || curVal)) {
        correcciones.push({ campo: `inmueble.${key}`, valor_ia: iaVal, valor_final: curVal });
      }
    }

    // Compare actos fields
    const actosKeys: (keyof Actos)[] = [
      "tipo_acto", "valor_compraventa", "es_hipoteca" as any, "valor_hipoteca", "entidad_bancaria",
    ];
    for (const key of actosKeys) {
      const iaVal = String((dataIa as any)?.[key] ?? (dataIa as any)?.actos?.[key] ?? "");
      const curVal = String(currentData.actos[key] ?? "");
      if (iaVal !== curVal && (iaVal || curVal)) {
        correcciones.push({ campo: `actos.${key}`, valor_ia: iaVal, valor_final: curVal });
      }
    }

    // Compare personas by cedula
    const iaPersonas = [
      ...((dataIa as any)?.vendedores || []),
      ...((dataIa as any)?.compradores || []),
    ];
    const curPersonas = [...currentData.vendedores, ...currentData.compradores];
    const personaFields: (keyof Persona)[] = [
      "nombre_completo", "numero_cedula", "estado_civil", "direccion", "municipio_domicilio",
    ];

    for (const curP of curPersonas) {
      if (!curP.numero_cedula) continue;
      const iaP = iaPersonas.find((p: any) =>
        (p.numero_cedula || p.numero_identificacion) === curP.numero_cedula
      );
      if (!iaP) continue;
      for (const key of personaFields) {
        const iaVal = String(iaP[key] ?? iaP[key === "numero_cedula" ? "numero_identificacion" : key] ?? "");
        const curVal = String(curP[key] ?? "");
        if (iaVal !== curVal && (iaVal || curVal)) {
          correcciones.push({
            campo: `persona.${curP.numero_cedula}.${key}`,
            valor_ia: iaVal,
            valor_final: curVal,
          });
        }
      }
    }

    return correcciones;
  };

  const handleSave = async () => {
    if (!inmueble.identificador_predial) {
      toast({ title: "Error", description: "El Identificador Predial es obligatorio.", variant: "destructive" });
      return;
    }
    if (!profile?.organization_id) {
      toast({ title: "Error", description: "No se encontró tu organización.", variant: "destructive" });
      return;
    }

    setSaving(true);
    setSyncStatus("saving");
    try {
      let tid = tramiteId;

      const metadata = {
        last_saved: new Date().toISOString(),
        custom_variables: customVariables.map(cv => ({ ...cv })),
        progress: calculateProgress(),
        confianza_map: Object.fromEntries(confianzaFields),
        ...(sugerenciasIA.length > 0 ? { sugerencias_ia: sugerenciasIA } : {}),
        ...(textoFinalWord ? { texto_final_word: textoFinalWord } : {}),
      } as Record<string, unknown>;

      if (!tid) {
        const { data, error } = await supabase
          .from("tramites")
          .insert({
            tipo: actos.tipo_acto || "Compraventa",
            organization_id: profile.organization_id,
            created_by: profile.id,
            status: "validado" as any,
            metadata: metadata as any,
          })
          .select()
          .single();
        if (error) throw error;
        tid = data.id;
        setTramiteId(tid);
        navigate(`/tramite/${tid}`, { replace: true });
      } else {
        await supabase.from("tramites").update({ status: "validado" as any, updated_at: new Date().toISOString(), metadata: metadata as any }).eq("id", tid);
        await supabase.from("personas").delete().eq("tramite_id", tid);
        await supabase.from("inmuebles").delete().eq("tramite_id", tid);
        await supabase.from("actos").delete().eq("tramite_id", tid);
      }

      const personasToInsert = [
        ...vendedores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "vendedor" as any })),
        ...compradores.map((p) => ({ ...personaToRow(p), tramite_id: tid!, rol: "comprador" as any })),
      ];
      if (personasToInsert.length) {
        const { error } = await supabase.from("personas").insert(personasToInsert);
        if (error) throw error;
      }

      const { error: inmError } = await supabase.from("inmuebles").insert({ ...inmuebleToRow(inmueble), tramite_id: tid! });
      if (inmError) throw inmError;

      const { error: actError } = await supabase.from("actos").insert({ ...actosToRow(actos), tramite_id: tid! });
      if (actError) throw actError;

      // --- Logging de correcciones ---
      if (dataIaSnapshot.current && tid) {
        const currentData = { vendedores, compradores, inmueble, actos };
        const correcciones = buildCorrecciones(dataIaSnapshot.current, currentData);

        const dataFinal = {
          vendedores: vendedores.map(v => ({ nombre_completo: v.nombre_completo, numero_cedula: v.numero_cedula, estado_civil: v.estado_civil, direccion: v.direccion, municipio_domicilio: v.municipio_domicilio })),
          compradores: compradores.map(c => ({ nombre_completo: c.nombre_completo, numero_cedula: c.numero_cedula, estado_civil: c.estado_civil, direccion: c.direccion, municipio_domicilio: c.municipio_domicilio })),
          inmueble: { matricula_inmobiliaria: inmueble.matricula_inmobiliaria, identificador_predial: inmueble.identificador_predial, departamento: inmueble.departamento, municipio: inmueble.municipio, direccion: inmueble.direccion, area: inmueble.area, linderos: inmueble.linderos, avaluo_catastral: inmueble.avaluo_catastral },
          actos: { tipo_acto: actos.tipo_acto, valor_compraventa: actos.valor_compraventa, es_hipoteca: actos.es_hipoteca, valor_hipoteca: actos.valor_hipoteca, entidad_bancaria: actos.entidad_bancaria },
          correcciones,
        };

        // Only write if there were actual corrections or first save
        await supabase
          .from("logs_extraccion")
          .update({ data_final: dataFinal as any, updated_at: new Date().toISOString() })
          .eq("tramite_id", tid);
      }

      setIsDirty(false);
      setSyncStatus("saved");
      toast({ title: "Trámite guardado", description: "Estado actualizado a Validado." });
    } catch (err: any) {
      setSyncStatus("unsaved");
      toast({ title: "Error al guardar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const [generating, setGenerating] = useState(false);

  const ensureUnlocked = async (): Promise<boolean> => {
    if (isUnlocked) return true;
    if (!tramiteId || !profile?.organization_id || !user) return false;

    const { data: success } = await supabase.rpc("unlock_expediente", {
      p_org_id: profile.organization_id,
      p_tramite_id: tramiteId,
      p_user_id: user.id,
    });

    if (!success) {
      toast({
        title: "Créditos insuficientes",
        description: "Necesitas al menos 2 créditos para activar este expediente.",
        variant: "destructive",
      });
      return false;
    }

    setIsUnlocked(true);
    await refreshCredits();
    toast({
      title: "Trámite activado",
      description: "2 créditos consumidos. OCR y generación ilimitada habilitada.",
    });
    return true;
  };

  const handlePrevisualizar = async () => {
    if (!tramiteId || !profile?.organization_id) {
      setPreviewOpen(true);
      return;
    }

    setValidando(true);
    try {
      const datosExtraidos = {
        vendedores: vendedores.map(v => ({
          nombre_completo: v.nombre_completo,
          numero_cedula: v.numero_cedula,
          estado_civil: v.estado_civil,
          direccion: v.direccion,
          municipio_domicilio: v.municipio_domicilio,
          es_persona_juridica: v.es_persona_juridica,
          razon_social: v.razon_social,
          nit: v.nit,
        })),
        compradores: compradores.map(c => ({
          nombre_completo: c.nombre_completo,
          numero_cedula: c.numero_cedula,
          estado_civil: c.estado_civil,
          direccion: c.direccion,
          municipio_domicilio: c.municipio_domicilio,
          es_persona_juridica: c.es_persona_juridica,
          razon_social: c.razon_social,
          nit: c.nit,
        })),
        inmueble: {
          matricula_inmobiliaria: inmueble.matricula_inmobiliaria,
          identificador_predial: inmueble.identificador_predial,
          departamento: inmueble.departamento,
          municipio: inmueble.municipio,
          direccion: inmueble.direccion,
          area: inmueble.area,
          linderos: inmueble.linderos,
          avaluo_catastral: inmueble.avaluo_catastral,
          codigo_orip: inmueble.codigo_orip,
        },
        actos: {
          tipo_acto: actos.tipo_acto,
          valor_compraventa: actos.valor_compraventa,
          es_hipoteca: actos.es_hipoteca,
          valor_hipoteca: actos.valor_hipoteca,
          entidad_bancaria: actos.entidad_bancaria,
        },
      };

      const validacionesApp: string[] = [];
      if (vendedores.length > 0 || compradores.length > 0) {
        validacionesApp.push("cruce_roles_certificado_completado");
      }
      const tienePendientes = [...vendedores, ...compradores].some(
        (p: any) => p.pendiente === true
      );
      if (tienePendientes) {
        validacionesApp.push("placeholders_pendientes_aplicados");
      }

      const resultado = await validarConClaude({
        modo: "documento",
        tramiteId,
        organizationId: profile.organization_id,
        tipoActo: actos.tipo_acto || "compraventa",
        datosExtraidos,
        validacionesApp,
      });

      // Error sistema → no bloquear, abrir preview directamente
      if (resultado.estado === "error_sistema") {
        setPreviewOpen(true);
        return;
      }

      // Aprobado sin problemas
      if (resultado.estado === "aprobado" && !tieneErroresCriticos(resultado)) {
        setPreviewOpen(true);
        return;
      }

      // Errores críticos → mostrar dialog
      if (tieneErroresCriticos(resultado)) {
        setValidacionResultado(resultado);
        setValidacionDialogOpen(true);
        return;
      }

      // Solo advertencias/sugerencias → toast + abrir preview
      const conteo = contarPorNivel(resultado);
      sonnerToast.info(
        `Validación: ${resultado.puntuacion ?? "—"}/100 — ${conteo.advertencias} advertencia(s), ${conteo.sugerencias} sugerencia(s)`,
        { description: resultado.retroalimentacion_general, duration: 6000 }
      );
      setPreviewOpen(true);
    } catch (err) {
      console.error("Error en validación pre-preview:", err);
      // Fallback: abrir preview sin bloquear
      setPreviewOpen(true);
    } finally {
      setValidando(false);
    }
  };

  const handleConfirmGenerate = async () => {
    if (!tramiteId || !profile?.organization_id) {
      toast({ title: "Error", description: "Guarda el trámite primero.", variant: "destructive" });
      return;
    }

    if (!organization?.nit || !organization?.name) {
      toast({ title: "Datos legales incompletos", description: "La Razón Social y el NIT de tu entidad deben estar registrados antes de generar documentos.", variant: "destructive" });
      return;
    }

    const unlocked = await ensureUnlocked();
    if (!unlocked) return;

    // Save current data first
    await handleAutoSave();

    setGenerating(true);
    setGeneratingWord(true);
    try {
      // Call process-expediente (orchestrator)
      const { data: result, error: fnError } = await monitored.invoke("process-expediente", {
        tramite_id: tramiteId,
      }, { tramiteId });
      if (fnError) throw new Error("Error en el pipeline de IA: " + fnError.message);
      if (result?.error) throw new Error(result.error);

      // Store AI results
      const aiTexto = result.texto_final_word || "";
      const aiSugerencias: SugerenciaIA[] = result.sugerencias_ia || [];
      
      // Snapshot the AI data for correction logging
      const templateData = result.templateData || result;
      dataIaSnapshot.current = JSON.parse(JSON.stringify(templateData));

      setTextoFinalWord(aiTexto);
      setSugerenciasIA(aiSugerencias);

      // Also generate the .docx download using templateData
      const response = await fetch("/template_venta_hipoteca.docx");
      const content = await response.arrayBuffer();

      // PizZip and Docxtemplater are now static imports at top of file

      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{", end: "}" },
        nullGetter: () => undefined,
      });

      const safeData = Object.fromEntries(
        Object.entries(templateData).filter(([k]) => k !== "texto_final_word" && k !== "sugerencias_ia")
          .map(([k, v]) => [k, typeof v === "string" ? (v || "__________") : v])
      );

      doc.render(safeData);

      let outZip = doc.getZip();
      if (customVariables.length > 0) {
        const docXml = outZip.file("word/document.xml");
        if (docXml) {
          let xmlContent = docXml.asText();
          for (const cv of customVariables) {
            if (cv.value && cv.originalText) {
              xmlContent = xmlContent.split(cv.originalText).join(cv.value);
            }
          }
          outZip.file("word/document.xml", xmlContent);
        }
      }

      const out = outZip.generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const fileName = `Escritura_${actos.tipo_acto || "Tramite"}_${tramiteId.slice(0, 8)}.docx`;
      const url = window.URL.createObjectURL(out);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();

      await supabase.from("tramites").update({ status: "word_generado" }).eq("id", tramiteId);
      await refreshCredits();
      setIsDirty(false);
      setSyncStatus("saved");
      toast({ title: "¡Éxito!", description: "Documento generado. Revisa las sugerencias de la IA en el visor." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
      setGeneratingWord(false);
    }
  };

  const syncIndicator = () => {
    switch (syncStatus) {
      case "saved":
        return (
          <span className="flex items-center gap-1 text-xs text-secondary">
            <Cloud className="h-3.5 w-3.5" /> Guardado
          </span>
        );
      case "saving":
        return (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...
          </span>
        );
      case "unsaved":
        return (
          <span className="flex items-center gap-1 text-xs text-accent">
            <CloudOff className="h-3.5 w-3.5" /> Sin guardar
          </span>
        );
      default:
        return null;
    }
  };

  const renderTabs = () => (
    <Tabs defaultValue="vendedores" className="w-full">
      <TabsList className="mb-6 w-full">
        <TabsTrigger value="vendedores" className="flex-1">Vendedores</TabsTrigger>
        <TabsTrigger value="compradores" className="flex-1">Compradores</TabsTrigger>
        <TabsTrigger value="inmueble" className="flex-1">Inmueble</TabsTrigger>
        <TabsTrigger value="actos" className="flex-1">Actos</TabsTrigger>
      </TabsList>
      <TabsContent value="vendedores">
        <PersonaForm title="Vendedores" personas={vendedores} onChange={setVendedores} confianzaFields={confianzaFields} onConfianzaChange={handleConfianzaChange} />
      </TabsContent>
      <TabsContent value="compradores">
        <PersonaForm title="Compradores" personas={compradores} onChange={setCompradores} confianzaFields={confianzaFields} onConfianzaChange={handleConfianzaChange} />
      </TabsContent>
      <TabsContent value="inmueble">
        <InmuebleForm
          inmueble={inmueble}
          onChange={(v) => { manuallyEditedFieldsRef.current.add("inmueble_manual"); setInmueble(v); }}
          onPersonasExtracted={handlePersonasExtracted}
          onDocumentoExtracted={handleDocumentoExtracted}
          onPredialExtracted={handlePredialExtracted}
          onActosExtracted={handleActosExtracted}
          confianzaFields={confianzaFields}
          onConfianzaChange={handleConfianzaChange}
        />
      </TabsContent>
      <TabsContent value="actos">
        <ActosForm actos={actos} onChange={setActos} />
      </TabsContent>
    </Tabs>
  );

  return (
    <div className="flex h-dvh flex-col bg-background lg:overflow-hidden overflow-auto">
      <header className="border-b bg-notarial-dark text-white shrink-0">
        <div className="container flex h-14 items-center gap-4">
          <Button variant="ghost-dark" size="sm" onClick={handleBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Dashboard
          </Button>
          <span className="text-sm font-medium">Validación de Escritura</span>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant="outline" className="border-notarial-gold/30 text-notarial-gold">
              <Coins className="mr-1 h-3 w-3" /> {credits} créditos
            </Badge>
            {syncIndicator()}
            <Button variant="ghost-dark" size="sm" onClick={handleSave} disabled={saving} className="border border-white/30">
              <Save className="mr-1 h-4 w-4" /> {saving ? "Guardando..." : "Guardar"}
            </Button>
            <Button
              size="sm"
              onClick={handlePrevisualizar}
              disabled={validando}
              className="bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90"
            >
              {validando ? (
                <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Validando...</>
              ) : (
                <><Eye className="mr-1 h-4 w-4" /> Previsualizar</>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Desktop: split view */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 hidden lg:flex">
        <ResizablePanel defaultSize={50} minSize={30} className="min-h-0 overflow-hidden">
          <DocxPreview
            vendedores={vendedores}
            compradores={compradores}
            inmueble={inmueble}
            actos={actos}
            customVariables={customVariables}
            onFieldEdit={handleFieldEdit}
            onCreateCustomVariable={handleCreateCustomVariable}
            sugerenciasIA={sugerenciasIA}
            generating={generatingWord}
            textoFinalWord={textoFinalWord}
            onSugerenciaAccepted={handleSugerenciaAccepted}
            notariaConfig={notariaConfig}
            extractedDocumento={extractedDocumento}
            extractedPredial={extractedPredial}
            onScrollToField={onScrollToField}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={35} className="min-h-0 overflow-hidden">
          <ScrollArea className="h-full" style={{ overscrollBehavior: 'contain' }}>
            <div className="container max-w-2xl py-6">
              {renderTabs()}
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Mobile: stacked column */}
      <div className="flex-1 flex flex-col lg:hidden">
        <div className="container max-w-2xl py-6">
          {renderTabs()}
        </div>
      </div>

      <PreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        vendedores={vendedores}
        compradores={compradores}
        inmueble={inmueble}
        actos={actos}
        onConfirm={handleConfirmGenerate}
        generating={generating}
      />

      {/* Dialog de validación Claude — errores críticos */}
      <AlertDialog open={validacionDialogOpen} onOpenChange={setValidacionDialogOpen}>
        <AlertDialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Revisión de validación
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {validacionResultado && (
                  <>
                    {validacionResultado.puntuacion != null && (
                      <p className="text-sm font-medium">
                        Puntuación: <span className="text-foreground">{validacionResultado.puntuacion}/100</span>
                      </p>
                    )}
                    <p className="text-sm">{validacionResultado.retroalimentacion_general}</p>

                    {/* Errores */}
                    {validacionResultado.validaciones.filter(v => v.nivel === "error").length > 0 && (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" /> Errores
                        </p>
                        {validacionResultado.validaciones.filter(v => v.nivel === "error").map((v, i) => (
                          <div key={i} className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs">
                            <span className="font-medium">{v.campo}</span>: {v.explicacion}
                            {v.valor_sugerido && (
                              <span className="block text-muted-foreground mt-0.5">Sugerido: {v.valor_sugerido}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Advertencias */}
                    {validacionResultado.validaciones.filter(v => v.nivel === "advertencia").length > 0 && (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-yellow-600 flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" /> Advertencias
                        </p>
                        {validacionResultado.validaciones.filter(v => v.nivel === "advertencia").map((v, i) => (
                          <div key={i} className="rounded border border-yellow-500/30 bg-yellow-500/5 p-2 text-xs">
                            <span className="font-medium">{v.campo}</span>: {v.explicacion}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Sugerencias */}
                    {validacionResultado.validaciones.filter(v => v.nivel === "sugerencia").length > 0 && (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-blue-600 flex items-center gap-1">
                          <Info className="h-3.5 w-3.5" /> Sugerencias
                        </p>
                        {validacionResultado.validaciones.filter(v => v.nivel === "sugerencia").map((v, i) => (
                          <div key={i} className="rounded border border-blue-500/30 bg-blue-500/5 p-2 text-xs">
                            <span className="font-medium">{v.campo}</span>: {v.explicacion}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Corregir</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setValidacionDialogOpen(false);
                setPreviewOpen(true);
              }}
              className="bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90"
            >
              Continuar de todas formas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const personaToRow = (p: Persona) => ({
  nombre_completo: p.nombre_completo,
  numero_cedula: p.numero_cedula,
  estado_civil: p.estado_civil,
  direccion: p.direccion,
  municipio_domicilio: p.municipio_domicilio,
  es_persona_juridica: p.es_persona_juridica,
  razon_social: p.razon_social,
  nit: p.nit,
  representante_legal_nombre: p.representante_legal_nombre,
  representante_legal_cedula: p.representante_legal_cedula,
  es_pep: p.es_pep,
  actua_mediante_apoderado: p.actua_mediante_apoderado,
  apoderado_persona_nombre: p.apoderado_persona_nombre,
  apoderado_persona_cedula: p.apoderado_persona_cedula,
  apoderado_persona_municipio: p.apoderado_persona_municipio,
  lugar_expedicion: p.lugar_expedicion || "",
});

const inmuebleToRow = (i: Inmueble) => ({
  matricula_inmobiliaria: i.matricula_inmobiliaria,
  tipo_identificador_predial: i.tipo_identificador_predial,
  identificador_predial: i.identificador_predial,
  departamento: i.departamento,
  municipio: i.municipio,
  codigo_orip: i.codigo_orip,
  tipo_predio: i.tipo_predio,
  direccion: i.direccion,
  estrato: i.estrato || "",
  area: i.area,
  area_construida: i.area_construida,
  area_privada: i.area_privada,
  linderos: i.linderos,
  valorizacion: i.valorizacion || "",
  avaluo_catastral: i.avaluo_catastral,
  escritura_ph: i.escritura_ph,
  reformas_ph: i.reformas_ph,
  es_propiedad_horizontal: i.es_propiedad_horizontal,
  matricula_matriz: i.matricula_matriz || "",
  nupre: i.nupre || "",
});

const actosToRow = (a: Actos) => ({
  tipo_acto: a.tipo_acto,
  valor_compraventa: a.valor_compraventa,
  es_hipoteca: a.es_hipoteca,
  valor_hipoteca: a.valor_hipoteca,
  entidad_bancaria: a.entidad_bancaria,
  apoderado_nombre: a.apoderado_nombre,
  apoderado_cedula: a.apoderado_cedula,
  apoderado_expedida_en: a.apoderado_expedida_en || "",
  apoderado_escritura_poder: a.apoderado_escritura_poder || "",
  apoderado_fecha_poder: a.apoderado_fecha_poder || "",
  apoderado_notaria_poder: a.apoderado_notaria_poder || "",
  apoderado_notaria_ciudad: a.apoderado_notaria_ciudad || "",
  apoderado_email: a.apoderado_email || "",
  pago_inicial: a.pago_inicial || "",
  saldo_financiado: a.saldo_financiado || "",
  fecha_credito: a.fecha_credito || "",
  entidad_nit: a.entidad_nit || "",
  entidad_domicilio: a.entidad_domicilio || "",
  afectacion_vivienda_familiar: a.afectacion_vivienda_familiar ?? false,
});

export default Validacion;
