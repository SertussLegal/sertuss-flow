import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Save, Eye, Cloud, CloudOff, Loader2, Coins, AlertTriangle, AlertCircle, Info, CheckCircle2, FileText, FolderOpen, Edit3, Check, Sparkles, Download } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import DocxPreview, { createEmptyNotariaTramite } from "@/components/tramites/DocxPreview";
import type { NotariaTramite } from "@/components/tramites/DocxPreview";
import OcrSuggestion from "@/components/tramites/OcrSuggestion";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import PreviewModal from "@/components/tramites/PreviewModal";
import PdfViewerPane from "@/components/tramites/PdfViewerPane";
import { emitCreditsBlocked, isCreditsBlockedError } from "@/lib/creditsBus";
import { createEmptyPersona, createEmptyInmueble, createEmptyActos } from "@/lib/types";
import type { Persona, Inmueble, Actos, TextOverride, CustomVariable, SugerenciaIA, NivelConfianza } from "@/lib/types";
import { supabase } from "@/integrations/supabase/client";
import { monitored } from "@/services/monitoredClient";
import { consumeCredit, notifyHttpQuotaError } from "@/services/credits";
import { useAuth } from "@/contexts/AuthContext";
import { lookupBank } from "@/lib/bankDirectory";
import { reconcilePersonas, reconcileInmueble, sanitizeDireccion, sanitizeEstadoCivil } from "@/lib/reconcileData";
import type { ReconcileAlert } from "@/lib/reconcileData";
import { formatMonedaLegal, formatCedulaLegal, formatFechaLegal, normalizeFieldCasing, numeroNotariaToLetras, numeroToOrdinalAbbr, detectarFormatoOrdinal, letrasNotariaToNumero, coeficienteToLetras, type FormatoOrdinal } from "@/lib/legalFormatters";
import ExpedienteSidebar from "@/components/tramites/ExpedienteSidebar";
import type { ExpedienteDoc } from "@/components/tramites/ExpedienteSidebar";

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

/** Robust DOCX XML override algorithm with text virtualization and node consolidation */
function applyOverridesToDocx(xml: string, overrides: TextOverride[]): string {
  const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim();

  // Extract all <w:t> nodes with positions
  const wtRegex = /<w:t([^>]*)>([^<]*)<\/w:t>/g;
  interface WtNode { fullMatch: string; attrs: string; text: string; start: number; end: number; }
  const nodes: WtNode[] = [];
  let m: RegExpExecArray | null;
  while ((m = wtRegex.exec(xml)) !== null) {
    nodes.push({ fullMatch: m[0], attrs: m[1], text: m[2], start: m.index, end: m.index + m[0].length });
  }

  if (nodes.length === 0) return xml;

  // Build virtual plaintext with position map
  const virtualText = nodes.map(n => n.text).join("");
  // charToNode[i] = which node index contains virtual char i
  const charToNode: number[] = [];
  nodes.forEach((n, idx) => {
    for (let i = 0; i < n.text.length; i++) charToNode.push(idx);
  });

  // Collect all replacements as { virtualStart, virtualEnd, newText }
  const replacements: { virtualStart: number; virtualEnd: number; newText: string }[] = [];
  const normalizedVirtual = normalizeWs(virtualText);

  for (const ov of overrides) {
    if (!ov.originalText || !ov.newText) continue;
    const normalizedOriginal = normalizeWs(ov.originalText);

    if (ov.replaceAll) {
      let searchStart = 0;
      while (true) {
        const idx = normalizedVirtual.indexOf(normalizedOriginal, searchStart);
        if (idx === -1) break;
        // Map back to virtualText position (approximate — works when normalization only collapses spaces)
        const vtIdx = virtualText.toLowerCase().indexOf(ov.originalText.toLowerCase(), searchStart);
        if (vtIdx !== -1) {
          replacements.push({ virtualStart: vtIdx, virtualEnd: vtIdx + ov.originalText.length, newText: ov.newText });
          searchStart = vtIdx + ov.originalText.length;
        } else {
          break;
        }
      }
    } else {
      // Context-aware single match
      const searchStr = ov.contextBefore
        ? normalizeWs(ov.contextBefore + ov.originalText + ov.contextAfter)
        : normalizedOriginal;
      const ctxIdx = normalizedVirtual.indexOf(searchStr);
      if (ctxIdx !== -1) {
        const offset = ov.contextBefore ? normalizeWs(ov.contextBefore).length : 0;
        const vtIdx = virtualText.indexOf(ov.originalText, Math.max(0, ctxIdx + offset - 5));
        if (vtIdx !== -1) {
          replacements.push({ virtualStart: vtIdx, virtualEnd: vtIdx + ov.originalText.length, newText: ov.newText });
        }
      } else {
        // Fallback: first occurrence
        const vtIdx = virtualText.indexOf(ov.originalText);
        if (vtIdx !== -1) {
          replacements.push({ virtualStart: vtIdx, virtualEnd: vtIdx + ov.originalText.length, newText: ov.newText });
        }
      }
    }
  }

  if (replacements.length === 0) return xml;

  // Sort by position descending to apply from end to start (avoids offset shifting)
  replacements.sort((a, b) => b.virtualStart - a.virtualStart);

  // Apply replacements to XML by modifying node texts
  let result = xml;
  for (const rep of replacements) {
    if (rep.virtualStart >= charToNode.length) continue;
    const startNode = charToNode[rep.virtualStart];
    const endNode = charToNode[Math.min(rep.virtualEnd - 1, charToNode.length - 1)];

    // Calculate offsets within nodes
    let charsBefore = 0;
    for (let i = 0; i < startNode; i++) charsBefore += nodes[i].text.length;
    const startOffset = rep.virtualStart - charsBefore;

    let charsBeforeEnd = 0;
    for (let i = 0; i <= endNode; i++) charsBeforeEnd += nodes[i].text.length;
    const endOffset = rep.virtualEnd - (charsBeforeEnd - nodes[endNode].text.length);

    if (startNode === endNode) {
      // Same node — simple replace
      const node = nodes[startNode];
      const newNodeText = node.text.slice(0, startOffset) + escapeXml(rep.newText) + node.text.slice(endOffset);
      const newTag = `<w:t${node.attrs}>${newNodeText}</w:t>`;
      result = result.slice(0, node.start) + newTag + result.slice(node.end);
      // Update node end for subsequent replacements
      const delta = newTag.length - (node.end - node.start);
      for (let i = startNode + 1; i < nodes.length; i++) {
        nodes[i].start += delta;
        nodes[i].end += delta;
      }
      nodes[startNode] = { ...node, fullMatch: newTag, text: newNodeText, end: node.start + newTag.length };
    } else {
      // Multi-node: consolidate into first node, empty the rest
      // Process from last to first to avoid offset issues
      for (let i = endNode; i >= startNode; i--) {
        const node = nodes[i];
        let newNodeText: string;
        if (i === startNode) {
          newNodeText = node.text.slice(0, startOffset) + escapeXml(rep.newText);
        } else if (i === endNode) {
          newNodeText = node.text.slice(endOffset);
        } else {
          newNodeText = "";
        }
        const preserveSpace = newNodeText.length > 0 && (newNodeText.startsWith(" ") || newNodeText.endsWith(" "))
          ? ' xml:space="preserve"' : node.attrs;
        const newTag = `<w:t${preserveSpace}>${newNodeText}</w:t>`;
        result = result.slice(0, node.start) + newTag + result.slice(node.end);
        const delta = newTag.length - (node.end - node.start);
        for (let j = i + 1; j < nodes.length; j++) {
          nodes[j].start += delta;
          nodes[j].end += delta;
        }
        nodes[i] = { ...node, fullMatch: newTag, text: newNodeText, end: node.start + newTag.length };
      }
    }
  }

  return result;
}

const Validacion = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { toast } = useToast();
  const { user, profile, organization, credits, refreshCredits } = useAuth();
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [radicado, setRadicado] = useState<string>("");
  const [radicadoDraft, setRadicadoDraft] = useState<string>("");
  const [savingRadicado, setSavingRadicado] = useState(false);
  const [editingRadicado, setEditingRadicado] = useState(false);

  const [tramiteId, setTramiteId] = useState<string | null>(id ?? null);
  const [vendedores, setVendedores] = useState<Persona[]>([createEmptyPersona()]);
  const [compradores, setCompradores] = useState<Persona[]>([createEmptyPersona()]);
  const [inmueble, setInmueble] = useState<Inmueble>(createEmptyInmueble());
  const [actos, setActos] = useState<Actos>(createEmptyActos());
  const [overrides, setOverrides] = useState<TextOverride[]>([]);
  const [manualFieldOverrides, setManualFieldOverrides] = useState<Record<string, string>>({});
  const [sugerenciasIA, setSugerenciasIA] = useState<SugerenciaIA[]>([]);
  const [textoFinalWord, setTextoFinalWord] = useState<string>("");
  const [generatingWord, setGeneratingWord] = useState(false);
  const [docxPath, setDocxPath] = useState<string | null>(null);
  const [showFinalView, setShowFinalView] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [showDocPanel, setShowDocPanel] = useState(false);
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
  const [slotsPendientes, setSlotsPendientes] = useState<string[]>([]);
  const [expedienteDocs, setExpedienteDocs] = useState<ExpedienteDoc[]>([]);
  const [docToggles, setDocToggles] = useState<{ tieneCredito: boolean; tieneApoderado: boolean }>({ tieneCredito: false, tieneApoderado: false });
  const [validando, setValidando] = useState(false);
  const [sidebarUploading, setSidebarUploading] = useState<string | null>(null);
  const [tramiteMetadata, setTramiteMetadata] = useState<Record<string, any> | null>(null);
  const [validacionDialogOpen, setValidacionDialogOpen] = useState(false);
  const [validacionResultado, setValidacionResultado] = useState<Awaited<ReturnType<typeof validarConClaude>> | null>(null);
  const [validacionCampos, setValidacionCampos] = useState<Awaited<ReturnType<typeof validarConClaude>> | null>(null);
  const [validandoCampos, setValidandoCampos] = useState(false);
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [notariaTramite, setNotariaTramite] = useState<NotariaTramite>(createEmptyNotariaTramite());
  const [notariaPanelOpen, setNotariaPanelOpen] = useState(false);
  const [ignoredNotariaSuggestions, setIgnoredNotariaSuggestions] = useState<Set<string>>(new Set());
  // Campos del bloque notaría que el usuario tocó manualmente (no auto-derivar al cambiar el número)
  const [notariaManualOverrides, setNotariaManualOverrides] = useState<Set<keyof NotariaTramite>>(new Set());
  const [formatoOrdinalNotaria, setFormatoOrdinalNotaria] = useState<FormatoOrdinal>("volada");
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
  }, [vendedores, compradores, inmueble, actos, overrides, notariaTramite]);

  // Auto-save debounce: 15 seconds
  useEffect(() => {
    if (!isDirty || !profile?.organization_id) return;
    const timer = setTimeout(() => {
      handleAutoSave();
    }, 15000);
    return () => clearTimeout(timer);
  }, [isDirty, vendedores, compradores, inmueble, actos, overrides, notariaTramite, profile?.organization_id]);

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
    setDocxPath((t as any).docx_path ?? null);
    const rad = (t as any).radicado ?? "";
    setRadicado(rad);
    setRadicadoDraft(rad);

    const meta = (t as any).metadata;
    setTramiteMetadata(meta || null);
    // Restore overrides (with legacy migration from custom_variables)
    if (meta?.overrides) {
      setOverrides(meta.overrides);
    }
    if (meta?.manualFieldOverrides && typeof meta.manualFieldOverrides === "object") {
      setManualFieldOverrides(meta.manualFieldOverrides as Record<string, string>);
    }
    if (!meta?.overrides && meta?.custom_variables) {
      // Migrate legacy custom variables to TextOverride format
      setOverrides((meta.custom_variables as CustomVariable[]).map((cv: CustomVariable) => ({
        id: cv.id,
        originalText: cv.originalText,
        newText: cv.value || "",
        contextBefore: "",
        contextAfter: "",
        replaceAll: true,
        createdAt: new Date().toISOString(),
      })));
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

    // Restore notaria_tramite (datos de notaría POR TRÁMITE — sin pre-llenado desde org)
    if (meta?.notaria_tramite && typeof meta.notaria_tramite === "object") {
      const nt = { ...createEmptyNotariaTramite(), ...meta.notaria_tramite } as NotariaTramite;
      setNotariaTramite(nt);
      // Si los derivados ya tienen valor distinto al auto-derivado, marcarlos como manuales
      const overrides = new Set<keyof NotariaTramite>();
      const autoLetras = numeroNotariaToLetras(nt.numero_notaria);
      const autoOrdinal = numeroToOrdinalAbbr(nt.numero_notaria, "volada");
      if (nt.numero_notaria_letras && nt.numero_notaria_letras !== autoLetras) overrides.add("numero_notaria_letras");
      if (nt.numero_ordinal && nt.numero_ordinal !== autoOrdinal && nt.numero_ordinal !== numeroToOrdinalAbbr(nt.numero_notaria, "to")) overrides.add("numero_ordinal");
      setNotariaManualOverrides(overrides);
      if (nt.numero_ordinal) setFormatoOrdinalNotaria(detectarFormatoOrdinal(nt.numero_ordinal));
    } else {
      setNotariaTramite(createEmptyNotariaTramite());
      setNotariaManualOverrides(new Set());
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
        coeficiente: "coeficiente_copropiedad",
        coeficiente_copropiedad: "coeficiente_copropiedad",
        nombre_conjunto_edificio: "nombre_edificio_conjunto",
        nombre_edificio_conjunto: "nombre_edificio_conjunto",
        escritura_ph_numero: "escritura_ph_numero",
        escritura_ph_fecha: "escritura_ph_fecha",
        escritura_ph_notaria: "escritura_ph_notaria",
        escritura_ph_ciudad: "escritura_ph_ciudad",
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
    // Priority: notaria_style_id on tramite > first org notaria > configuracion_notaria
    if (t.organization_id) {
      const notariaStyleId = (t as any).notaria_style_id;
      const [{ data: ns }, { data: cn }] = await Promise.all([
        notariaStyleId
          ? supabase.from("notaria_styles").select("*").eq("id", notariaStyleId).maybeSingle()
          : supabase.from("notaria_styles").select("*").eq("organization_id", t.organization_id).limit(1).maybeSingle(),
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

    // ── 6b. Load slots_pendientes from metadata toggles ──
    if (meta?.slots_pendientes && Array.isArray(meta.slots_pendientes)) {
      setSlotsPendientes(meta.slots_pendientes);
    } else {
      setSlotsPendientes([]);
    }

    // ── 6b2. Restore toggle state → sync with actos.es_hipoteca ──
    const restoredToggles = {
      tieneCredito: !!meta?.toggles?.tieneCredito,
      tieneApoderado: !!meta?.toggles?.tieneApoderado,
    };
    setDocToggles(restoredToggles);
    if (restoredToggles.tieneCredito && !localActos.es_hipoteca) {
      localActos = { ...localActos, es_hipoteca: true };
    }

    // ── 6c. Build expediente docs list from metadata ──
    const docs: ExpedienteDoc[] = [
      { tipo: "certificado_tradicion", label: "Certificado de Tradición", status: meta?.extracted_inmueble ? "procesado" : "pendiente" },
      { tipo: "predial", label: "Cédula Catastral / Predial", status: meta?.extracted_predial ? "procesado" : "pendiente" },
      { tipo: "escritura_antecedente", label: "Escritura Antecedente", status: meta?.extracted_escritura_comparecientes?.length > 0 || meta?.extracted_documento ? "procesado" : "pendiente" },
    ];
    // Add persona docs
    const cedulasLoaded = meta?.extracted_cedulas_detail || meta?.extracted_personas || [];
    for (const ced of cedulasLoaded) {
      docs.push({
        tipo: `cedula_${ced.numero_identificacion || ced.numero_cedula || "unknown"}`,
        label: `Cédula — ${ced.nombre_completo || "Persona"}`,
        status: "procesado",
        nombre: ced.numero_identificacion || ced.numero_cedula,
      });
    }
    // Add optional pending slots
    if (meta?.toggles?.tieneCredito) {
      docs.push({
        tipo: "carta_credito",
        label: "Carta de Aprobación de Crédito",
        status: meta?.extracted_carta_credito ? "procesado" : "pendiente",
      });
    }
    if (meta?.toggles?.tieneApoderado) {
      docs.push({
        tipo: "poder_notarial",
        label: "Poder Notarial",
        status: meta?.extracted_poder_notarial ? "procesado" : "pendiente",
      });
    }
    setExpedienteDocs(docs);

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
  // Alias map: preview field name → data-field-input attribute name
  const FIELD_ALIAS: Record<string, string> = {
    "inmueble.matricula": "matricula_inmobiliaria",
    "inmueble.cedula_catastral": "identificador_predial",
    "inmueble.direccion": "direccion_inmueble",
    "inmueble.linderos_especiales": "linderos",
    "inmueble.linderos_generales": "linderos",
    "inmueble.municipio": "municipio",
    "inmueble.departamento": "departamento",
    "inmueble.orip_ciudad": "codigo_orip",
    "inmueble.orip_zona": "codigo_orip",
    "inmueble.area": "area",
    "inmueble.area_construida": "area_construida",
    "inmueble.area_privada": "area_privada",
    "inmueble.nupre": "nupre",
    "inmueble.estrato": "estrato",
    "inmueble.avaluo_catastral": "avaluo_catastral",
    "inmueble.tipo_predio": "tipo_predio",
    "actos.cuantia_compraventa_letras": "valor_compraventa",
    "actos.cuantia_compraventa_numero": "valor_compraventa",
    "actos.entidad_bancaria": "entidad_bancaria",
    "actos.cuantia_hipoteca_letras": "valor_hipoteca",
    "actos.cuantia_hipoteca_numero": "valor_hipoteca",
    "apoderado_banco.nombre": "apoderado_nombre",
    "apoderado_banco.cedula": "apoderado_cedula",
    "comparecientes_vendedor": "vendedor_0_nombre_completo",
    "comparecientes_comprador": "comprador_0_nombre_completo",
    // ── Notaría (panel colapsable arriba de los tabs) ──
    "notaria_numero": "notaria_numero",
    "notaria_numero_letras": "notaria_numero_letras",
    "notaria_numero_letras_lower": "notaria_numero_letras",
    "notaria_numero_letras_femenino": "notaria_numero_letras",
    "notaria_ordinal": "notaria_ordinal",
    "notaria_circulo": "notaria_circulo",
    "notaria_circulo_proper": "notaria_circulo",
    "notaria_departamento": "notaria_departamento",
  };

  // Set de campos que viven en el panel "Datos de la Notaría" (no en tabs)
  const NOTARIA_FIELD_SET = new Set([
    "notaria_numero",
    "notaria_numero_letras",
    "notaria_ordinal",
    "notaria_circulo",
    "notaria_departamento",
  ]);

  const onScrollToField = useCallback((field: string) => {
    const resolved = FIELD_ALIAS[field] || FIELD_TO_INMUEBLE[field] || FIELD_TO_ACTOS[field] || field;

    // Caso especial: campos de Notaría → abrir el panel colapsable, no cambiar de tab
    const isNotariaField =
      field.startsWith("notaria_") || NOTARIA_FIELD_SET.has(resolved);

    if (isNotariaField) {
      setNotariaPanelOpen(true);
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = document.querySelector(`[data-field-input="${resolved}"]`) as HTMLElement;
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.focus({ preventScroll: true });
            el.classList.remove("field-spotlight");
            void el.offsetWidth;
            el.classList.add("field-spotlight");
            window.setTimeout(() => el.classList.remove("field-spotlight"), 1300);
          }
        }, 120);
      });
      return;
    }

    const tabsEl = document.querySelector('[role="tablist"]');
    if (!tabsEl) return;

    let targetTab = "inmueble";
    if (field.startsWith("actos.") || field.startsWith("apoderado_banco.") || FIELD_TO_ACTOS[field] || resolved.startsWith("apoderado_") || resolved === "valor_compraventa" || resolved === "valor_hipoteca" || resolved === "entidad_bancaria" || resolved === "tipo_acto") {
      targetTab = "actos";
    } else if (field.includes("vendedor") || field.includes("compareciente") || resolved.startsWith("vendedor_")) {
      targetTab = "vendedores";
    } else if (field.includes("comprador") || resolved.startsWith("comprador_")) {
      targetTab = "compradores";
    }

    const trigger = tabsEl.querySelector(`[data-value="${targetTab}"]`) as HTMLElement;
    if (trigger) trigger.click();

    // Wait for tab content to render, then scroll + spotlight
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.querySelector(`[data-field-input="${resolved}"]`) as HTMLElement;
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.focus({ preventScroll: true });
          // Reinicia la animación si el usuario reclica el mismo campo
          el.classList.remove("field-spotlight");
          // Force reflow para reiniciar el keyframe
          void el.offsetWidth;
          el.classList.add("field-spotlight");
          window.setTimeout(() => el.classList.remove("field-spotlight"), 1300);
        }
      }, 100);
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
        overrides: overrides.map(ov => ({ ...ov })),
        manualFieldOverrides: { ...manualFieldOverrides },
        progress: calculateProgress(),
        confianza_map: Object.fromEntries(confianzaFields),
        notaria_tramite: notariaTramite,
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
  const handleFieldEdit = useCallback((field: string, value: string, anchorText?: string) => {
    // Track manually edited fields to prevent OCR overwrite
    manuallyEditedFieldsRef.current.add(field);

    // Normalize casing for notarial-style coherence (uppercase by default,
    // numeric/date/explicit-suffix fields passed through).
    const v = normalizeFieldCasing(field, value);

    if (field.startsWith("__override__")) {
      const ovId = field.replace("__override__", "");
      setOverrides((prev) =>
        prev.map((ov) => (ov.id === ovId ? { ...ov, newText: v } : ov))
      );
      return;
    }
    if (FIELD_TO_INMUEBLE[field]) {
      const inmuebleKey = FIELD_TO_INMUEBLE[field];
      manuallyEditedFieldsRef.current.add(inmuebleKey);
      setInmueble((prev) => ({ ...prev, [inmuebleKey]: v }));
      return;
    }
    if (FIELD_TO_ACTOS[field]) {
      const actosKey = FIELD_TO_ACTOS[field];
      manuallyEditedFieldsRef.current.add(actosKey);
      setActos((prev) => ({ ...prev, [actosKey]: v }));
      return;
    }

    // Universal fallback for unmapped placeholders: route through the canonical
    // replacements pipeline via manualFieldOverrides. This avoids fragile regex
    // matching on indistinguishable "___________" placeholders. Persisted in
    // metadata.manualFieldOverrides. handleCreateOverride is reserved for
    // free-text selections from the inline visor toolbar.
    setManualFieldOverrides((prev) => {
      if (!v) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      if (prev[field] === v) return prev;
      return { ...prev, [field]: v };
    });
    setIsDirty(true);
  }, []);

  // Ref bridge to avoid hoisting issues with handleCreateOverride defined later
  const handleCreateOverrideRef = useRef<
    ((originalText: string, newText: string, replaceAll: boolean, contextBefore: string, contextAfter: string) => void) | null
  >(null);

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
          // ── RE-MERGE INMUEBLE from freshly extracted data ──
          if (merged.extracted_inmueble) {
            const freshOcr = merged.extracted_inmueble || {};
            const dirtyFs = manuallyEditedFieldsRef.current;
            setInmueble(prev => {
              const result = { ...prev };
              const ocrFieldMap: Record<string, string> = {
                chip_nupre: "nupre", chip: "nupre",
                cedula_catastral: "identificador_predial", numero_predial: "identificador_predial",
                codigo_orip: "codigo_orip", orip_ciudad: "codigo_orip",
                matricula_inmobiliaria: "matricula_inmobiliaria", matricula: "matricula_inmobiliaria",
                matricula_matriz: "matricula_matriz", direccion: "direccion",
                municipio: "municipio", departamento: "departamento",
                area: "area", area_construida: "area_construida", area_privada: "area_privada",
                linderos: "linderos", linderos_especiales: "linderos_especiales", linderos_generales: "linderos_generales",
                avaluo_catastral: "avaluo_catastral", estrato: "estrato", nupre: "nupre",
                valorizacion: "valorizacion", escritura_ph: "escritura_ph",
                coeficiente: "coeficiente_copropiedad", coeficiente_copropiedad: "coeficiente_copropiedad",
                nombre_conjunto_edificio: "nombre_edificio_conjunto", nombre_edificio_conjunto: "nombre_edificio_conjunto",
                escritura_ph_numero: "escritura_ph_numero", escritura_ph_fecha: "escritura_ph_fecha",
                escritura_ph_notaria: "escritura_ph_notaria", escritura_ph_ciudad: "escritura_ph_ciudad",
                tipo_predio: "tipo_predio", es_propiedad_horizontal: "es_propiedad_horizontal",
              };
              for (const [ocrKey, val] of Object.entries(freshOcr)) {
                const dbKey = ocrFieldMap[ocrKey] || ocrKey;
                const strVal = typeof val === "object" && val !== null && "valor" in val ? String((val as any).valor ?? "") : String(val ?? "");
                if (strVal && dbKey in result && !dirtyFs.has(dbKey)) {
                  const current = (result as any)[dbKey];
                  if (!current || current === "" || current === false) {
                    (result as any)[dbKey] = dbKey === "es_propiedad_horizontal" ? (strVal === "true" || strVal === "1" || /horizontal/i.test(strVal)) : strVal;
                  }
                }
              }
              return result;
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

  // Background validation with Claude after each document upload (Momento 1: campos)
  // Fire-and-forget — never blocks UI, silent on failure.
  const validarDespuesDeCarga = useCallback((
    tipoDoc: "cedula" | "certificado" | "predial" | "escritura_previa" | "carta_credito" | "poder_notarial",
    datosDocumento: any,
    tabOrigen: "vendedores" | "compradores" | "inmueble" | "actos"
  ) => {
    if (!tramiteIdRef.current || !profile?.organization_id) return;
    setValidandoCampos(true);
    (async () => {
      try {
        const resultado = await validarConClaude({
          modo: "campos",
          tramiteId: tramiteIdRef.current!,
          organizationId: profile.organization_id!,
          tipoActo: actos.tipo_acto || "compraventa",
          tabOrigen,
          datosExtraidos: {
            documento_cargado: { tipo: tipoDoc, datos: datosDocumento },
            vendedores, compradores, inmueble, actos,
          },
          validacionesApp: [
            ...(vendedores.length || compradores.length ? ["cruce_roles_certificado_completado"] : []),
          ],
        });
        if (resultado.estado !== "error_sistema") {
          setValidacionCampos(resultado);
        }
      } catch {
        /* silencio total */
      } finally {
        setValidandoCampos(false);
      }
    })();
  }, [profile?.organization_id, vendedores, compradores, inmueble, actos]);

  // Handle sidebar document upload: invoke scan-document and re-hydrate
  const handleSidebarUpload = useCallback(async (tipo: string, file: File) => {
    if (!profile?.organization_id || !user) return;

    // Atomic credit consumption + audit (consume_credit_v2)
    const ok = await consumeCredit({
      organizationId: profile.organization_id,
      userId: user.id,
      action: "OCR_DOCUMENTO",
      tramiteId: tramiteId ?? null,
      tipoActo: actos.tipo_acto ?? null,
    });
    if (!ok) return;

    setSidebarUploading(tipo);
    try {
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Map sidebar tipo to scan-document type (corrected mapping)
      const scanType = tipo === "carta_credito" ? "carta_credito"
        : tipo === "poder_notarial" ? "poder_banco"
        : tipo as any;

      const { data, error } = await supabase.functions.invoke("scan-document", {
        body: { image: base64, type: scanType },
      });
      if (error) throw new Error(error.message);

      if (data?.data) {
        const d = data.data;
        const tid = tramiteIdRef.current;

        if (scanType === "certificado_tradicion" && d.inmueble) {
          const unwrapVal = (v: any): string => {
            if (!v) return "";
            if (typeof v === "object" && "valor" in v) return String(v.valor || "");
            return String(v);
          };
          setInmueble(prev => {
            const result = { ...prev };
            for (const [key, val] of Object.entries(d.inmueble || d)) {
              const strVal = unwrapVal(val);
              if (strVal && key in result && !manuallyEditedFieldsRef.current.has(key)) {
                const current = (result as any)[key];
                if (!current || current === "") (result as any)[key] = strVal;
              }
            }
            return result;
          });
        }

        if (d.personas && Array.isArray(d.personas)) {
          handlePersonasExtracted(d.personas);
        }

        if (d.documento) {
          handleDocumentoExtracted(d.documento);
        }

        // Hydrate actos from poder_banco OCR
        if (tipo === "poder_notarial" && d) {
          setActos(prev => ({
            ...prev,
            entidad_bancaria: d.entidad_bancaria || prev.entidad_bancaria,
            apoderado_nombre: d.apoderado_nombre || prev.apoderado_nombre,
            apoderado_cedula: d.apoderado_cedula || prev.apoderado_cedula,
            apoderado_expedida_en: d.apoderado_expedida_en || prev.apoderado_expedida_en,
            apoderado_escritura_poder: d.escritura_poder_num || prev.apoderado_escritura_poder,
            apoderado_fecha_poder: d.fecha_poder || prev.apoderado_fecha_poder,
            apoderado_notaria_poder: d.notaria_poder || prev.apoderado_notaria_poder,
            apoderado_notaria_ciudad: d.notaria_poder_ciudad || prev.apoderado_notaria_ciudad,
            apoderado_email: d.apoderado_email || prev.apoderado_email,
          }));
        }

        // Hydrate actos from carta_credito OCR
        if (tipo === "carta_credito" && d) {
          setActos(prev => ({
            ...prev,
            valor_hipoteca: d.valor_credito || prev.valor_hipoteca,
            entidad_bancaria: d.entidad_bancaria || prev.entidad_bancaria,
          }));
        }

        // Update expediente doc status
        setExpedienteDocs(prev => prev.map(doc =>
          doc.tipo === tipo ? { ...doc, status: "procesado" as const, nombre: file.name } : doc
        ));

        // Persist to metadata
        if (tid) {
          const { data: existing } = await supabase.from("tramites").select("metadata").eq("id", tid).single();
          const merged = { ...((existing?.metadata as any) || {}), [`extracted_${tipo}`]: d };
          await supabase.from("tramites").update({ metadata: merged as any }).eq("id", tid);
        }

        toast({ title: "Documento procesado", description: `${file.name} escaneado y datos actualizados.` });

        // Disparar validación Claude en background (Momento 1: campos)
        const tabOrigen: "vendedores" | "compradores" | "inmueble" | "actos" =
          scanType === "certificado_tradicion" || scanType === "predial" ? "inmueble"
          : tipo === "carta_credito" || tipo === "poder_notarial" ? "actos"
          : scanType === "escritura_antecedente" ? "vendedores"
          : tipo.startsWith("cedula_") ? "vendedores"
          : "vendedores";
        const tipoDocMapped: "cedula" | "certificado" | "predial" | "escritura_previa" | "carta_credito" | "poder_notarial" =
          scanType === "certificado_tradicion" ? "certificado"
          : scanType === "predial" ? "predial"
          : scanType === "escritura_antecedente" ? "escritura_previa"
          : tipo === "carta_credito" ? "carta_credito"
          : tipo === "poder_notarial" ? "poder_notarial"
          : "cedula";
        validarDespuesDeCarga(tipoDocMapped, d, tabOrigen);
      }
      await refreshCredits();
    } catch (err: any) {
      await supabase.rpc("restore_credit", { org_id: profile.organization_id });
      await refreshCredits();
      if (isCreditsBlockedError(err)) {
        emitCreditsBlocked({ source: "scan-document" });
      } else {
        toast({ title: "Error al procesar", description: err.message, variant: "destructive" });
      }
    } finally {
      setSidebarUploading(null);
    }
  }, [profile?.organization_id, toast, handlePersonasExtracted, handleDocumentoExtracted, validarDespuesDeCarga]);

  // ── Deep-clean state linked to a document type ──
  const cleanStateForDocType = useCallback((tipo: string) => {
    if (tipo === "certificado_tradicion") {
      setInmueble(createEmptyInmueble());
    } else if (tipo === "predial") {
      setExtractedPredial(null);
    } else if (tipo === "escritura_antecedente") {
      setExtractedDocumento(null);
    } else if (tipo.startsWith("cedula_")) {
      const cedNum = tipo.replace("cedula_", "");
      setVendedores(prev => prev.filter(v => v.numero_cedula !== cedNum));
      setCompradores(prev => prev.filter(c => c.numero_cedula !== cedNum));
    } else if (tipo === "carta_credito") {
      setActos(prev => ({ ...prev, valor_hipoteca: "", entidad_bancaria: "", es_hipoteca: false }));
    } else if (tipo === "poder_notarial") {
      setActos(prev => ({
        ...prev,
        apoderado_nombre: "", apoderado_cedula: "", apoderado_expedida_en: "",
        apoderado_escritura_poder: "", apoderado_fecha_poder: "",
        apoderado_notaria_poder: "", apoderado_notaria_ciudad: "", apoderado_email: "",
      }));
    }
  }, []);

  // ── Persist metadata key removal ──
  const removeMetadataKey = useCallback(async (tipo: string) => {
    const tid = tramiteIdRef.current;
    if (!tid) return;
    const { data: existing } = await supabase.from("tramites").select("metadata").eq("id", tid).single();
    const meta = { ...((existing?.metadata as any) || {}) };
    const keyMap: Record<string, string[]> = {
      certificado_tradicion: ["extracted_inmueble"],
      predial: ["extracted_predial"],
      escritura_antecedente: ["extracted_documento", "extracted_escritura_comparecientes", "extracted_titulo_antecedente"],
      carta_credito: ["extracted_carta_credito"],
      poder_notarial: ["extracted_poder_notarial", "extracted_poder_banco"],
    };
    const keys = keyMap[tipo] || [`extracted_${tipo}`];
    for (const k of keys) delete meta[k];
    // Also clean cedula from extracted_cedulas_detail
    if (tipo.startsWith("cedula_")) {
      const cedNum = tipo.replace("cedula_", "");
      if (meta.extracted_cedulas_detail) {
        meta.extracted_cedulas_detail = (meta.extracted_cedulas_detail as any[]).filter(
          (c: any) => (c.numero_identificacion || c.numero_cedula) !== cedNum
        );
      }
    }
    await supabase.from("tramites").update({ metadata: meta as any }).eq("id", tid);
  }, []);

  // ── handleSidebarDelete ──
  const handleSidebarDelete = useCallback(async (tipo: string) => {
    cleanStateForDocType(tipo);
    await removeMetadataKey(tipo);
    setExpedienteDocs(prev => {
      if (tipo.startsWith("cedula_")) {
        return prev.filter(d => d.tipo !== tipo);
      }
      return prev.map(d => d.tipo === tipo ? { ...d, status: "pendiente" as const, nombre: undefined } : d);
    });
    // Deactivate toggle if optional doc deleted
    if (tipo === "carta_credito") {
      setDocToggles(prev => ({ ...prev, tieneCredito: false }));
      setExpedienteDocs(prev => prev.filter(d => d.tipo !== "carta_credito"));
      persistToggles({ tieneCredito: false, tieneApoderado: docToggles.tieneApoderado });
    }
    if (tipo === "poder_notarial") {
      setDocToggles(prev => ({ ...prev, tieneApoderado: false }));
      setExpedienteDocs(prev => prev.filter(d => d.tipo !== "poder_notarial"));
      persistToggles({ tieneCredito: docToggles.tieneCredito, tieneApoderado: false });
    }
    toast({ title: "Documento eliminado", description: "Los datos vinculados han sido limpiados." });
  }, [cleanStateForDocType, removeMetadataKey, toast, docToggles]);

  // ── handleSidebarReplace ──
  const handleSidebarReplace = useCallback(async (tipo: string, file: File) => {
    cleanStateForDocType(tipo);
    await removeMetadataKey(tipo);
    setExpedienteDocs(prev => prev.map(d => d.tipo === tipo ? { ...d, status: "pendiente" as const, nombre: undefined } : d));
    // Re-process with OCR
    handleSidebarUpload(tipo, file);
  }, [cleanStateForDocType, removeMetadataKey, handleSidebarUpload]);

  // ── Persist toggles helper ──
  const persistToggles = useCallback(async (togglesState: { tieneCredito: boolean; tieneApoderado: boolean }) => {
    const tid = tramiteIdRef.current;
    if (!tid) return;
    const { data: existing } = await supabase.from("tramites").select("metadata").eq("id", tid).single();
    const meta = { ...((existing?.metadata as any) || {}), toggles: togglesState };
    await supabase.from("tramites").update({ metadata: meta as any }).eq("id", tid);
  }, []);

  // ── handleToggleChange ──
  const handleToggleChange = useCallback(async (toggle: string, value: boolean) => {
    const newToggles = { ...docToggles, [toggle]: value };
    setDocToggles(newToggles);

    if (toggle === "tieneCredito") {
      setActos(prev => ({ ...prev, es_hipoteca: value }));
      if (value) {
        setExpedienteDocs(prev => {
          if (prev.some(d => d.tipo === "carta_credito")) return prev;
          return [...prev, { tipo: "carta_credito", label: "Carta de Aprobación de Crédito", status: "pendiente" }];
        });
      } else {
        cleanStateForDocType("carta_credito");
        await removeMetadataKey("carta_credito");
        setExpedienteDocs(prev => prev.filter(d => d.tipo !== "carta_credito"));
      }
    }

    if (toggle === "tieneApoderado") {
      if (value) {
        setExpedienteDocs(prev => {
          if (prev.some(d => d.tipo === "poder_notarial")) return prev;
          return [...prev, { tipo: "poder_notarial", label: "Poder Notarial", status: "pendiente" }];
        });
      } else {
        cleanStateForDocType("poder_notarial");
        await removeMetadataKey("poder_notarial");
        setExpedienteDocs(prev => prev.filter(d => d.tipo !== "poder_notarial"));
      }
    }

    await persistToggles(newToggles);
  }, [docToggles, cleanStateForDocType, removeMetadataKey, persistToggles]);

  // ── handleSidebarAddCedula ──
  const handleSidebarAddCedula = useCallback(async (file: File) => {
    handleSidebarUpload("cedula", file);
  }, [handleSidebarUpload]);

  const handleCreateOverride = useCallback((
    originalText: string, newText: string, replaceAll: boolean,
    contextBefore: string, contextAfter: string
  ) => {
    const override: TextOverride = {
      id: crypto.randomUUID(),
      originalText,
      newText,
      contextBefore,
      contextAfter,
      replaceAll,
      createdAt: new Date().toISOString(),
    };
    setOverrides((prev) => [...prev, override]);
    toast({
      title: "Cambio aplicado",
      description: `"${originalText.slice(0, 30)}…" → "${newText.slice(0, 30)}…"`,
    });
  }, [toast]);

  // Wire ref so handleFieldEdit (defined earlier) can fall back to overrides
  useEffect(() => {
    handleCreateOverrideRef.current = handleCreateOverride;
  }, [handleCreateOverride]);

  const handleRemoveOverride = useCallback((id: string) => {
    setOverrides((prev) => prev.filter((o) => o.id !== id));
    toast({ title: "Cambio deshecho" });
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
        overrides: overrides.map(ov => ({ ...ov })),
        progress: calculateProgress(),
        confianza_map: Object.fromEntries(confianzaFields),
        notaria_tramite: notariaTramite,
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
        notaria_tramite: notariaTramite,
      }, { tramiteId });
      if (fnError) {
        if (isCreditsBlockedError(fnError, result)) {
          emitCreditsBlocked({ source: "process-expediente" });
          return;
        }
        throw new Error("Error en el pipeline de IA: " + fnError.message);
      }
      if (result?.error) {
        if (isCreditsBlockedError(null, result)) {
          emitCreditsBlocked({ source: "process-expediente" });
          return;
        }
        throw new Error(result.error);
      }

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

      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "{", end: "}" },
        nullGetter: () => "___________",
      });

      // Helper to parse fecha for template date fields
      const parseFechaFields = (fecha: string) => {
        if (!fecha) return { dia_letras: "___________", dia_num: "___________", mes: "___________", anio_letras: "___________", anio_num: "___________" };
        const match = fecha.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/) || fecha.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
        if (!match) return { dia_letras: "___________", dia_num: "___________", mes: "___________", anio_letras: "___________", anio_num: "___________" };
        const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
        let d: number, m: number, y: number;
        if (parseInt(match[1]) > 31) { y = parseInt(match[1]); m = parseInt(match[2]); d = parseInt(match[3]); }
        else { d = parseInt(match[1]); m = parseInt(match[2]); y = parseInt(match[3]); }
        return { dia_letras: "___________", dia_num: String(d), mes: meses[m-1] || "___________", anio_letras: "___________", anio_num: String(y) };
      };

      const _ = "___________";
      const mapPersona = (p: typeof vendedores[0]) => {
        // Red de seguridad final: aunque el dato venga de un borrador antiguo o
        // de una edición previa al refuerzo de sanitizadores, garantizamos que
        // al .docx solo llegue dirección postal/rural válida y estado civil atómico.
        const cleanDir = sanitizeDireccion(p.direccion || "");
        const cleanEstado = sanitizeEstadoCivil(p.estado_civil || "", p.nombre_completo || "");
        return {
          nombre: p.nombre_completo || _,
          cedula: p.numero_cedula ? formatCedulaLegal(p.numero_cedula) : _,
          expedida_en: p.lugar_expedicion || _,
          estado_civil: cleanEstado || _,
          domicilio: p.municipio_domicilio || _,
          direccion_residencia: cleanDir || _,
          telefono: _,
          actividad_economica: _,
          email: _,
          es_pep: p.es_pep,
          acepta_notificaciones: true,
        };
      };

      // Parse titulo antecedente dates
      const antFecha = parseFechaFields(extractedDocumento?.titulo_antecedente?.fecha_documento || extractedDocumento?.fecha_documento || "");
      // Parse RPH dates
      const rphFecha = parseFechaFields(inmueble.escritura_ph_fecha || "");
      // Parse credito dates
      const creditoFecha = parseFechaFields(actos.fecha_credito || "");

      const structuredData = {
        // Root-level
        escritura_numero: _,
        fecha_escritura_corta: new Date().toLocaleDateString("es-CO"),
        notario_nombre: notariaTramite.nombre_notario || _,
        notario_decreto: notariaTramite.decreto_nombramiento || _,
        notario_tipo: notariaTramite.tipo_notario || "",
        notaria_numero: notariaTramite.numero_notaria || _,
        // Fallbacks: si la edición manual está vacía, usar el valor derivado del número de notaría.
        notaria_numero_letras: notariaTramite.numero_notaria_letras
          || (notariaTramite.numero_notaria ? numeroNotariaToLetras(notariaTramite.numero_notaria) : _),
        notaria_numero_letras_lower: (() => {
          const base = notariaTramite.numero_notaria_letras
            || (notariaTramite.numero_notaria ? numeroNotariaToLetras(notariaTramite.numero_notaria) : "");
          return base ? base.toLowerCase() : _;
        })(),
        notaria_numero_letras_femenino: (() => {
          const base = notariaTramite.numero_notaria_letras
            || (notariaTramite.numero_notaria ? numeroNotariaToLetras(notariaTramite.numero_notaria) : "");
          if (!base) return _;
          const upper = base.toUpperCase();
          return upper.endsWith("O") ? upper.slice(0, -1) + "A" : upper;
        })(),
        notaria_ordinal: notariaTramite.numero_ordinal
          || (notariaTramite.numero_notaria ? numeroToOrdinalAbbr(notariaTramite.numero_notaria, formatoOrdinalNotaria) : _),
        notaria_circulo: notariaTramite.circulo || _,
        notaria_circulo_proper: notariaTramite.circulo
          ? notariaTramite.circulo.toLowerCase().replace(/(^|\s)\S/g, t => t.toUpperCase())
          : _,
        notaria_departamento: notariaTramite.departamento || _,

        // Booleans for conditionals
        tiene_hipoteca: actos.es_hipoteca,
        afectacion_vivienda: actos.afectacion_vivienda_familiar || false,

        // Person loops
        vendedores: vendedores.map(mapPersona),
        compradores: compradores.map(mapPersona),

        // Inmueble nested
        inmueble: {
          matricula: inmueble.matricula_inmobiliaria || _,
          cedula_catastral: inmueble.identificador_predial || _,
          direccion: inmueble.direccion || _,
          nombre_edificio_conjunto: inmueble.nombre_edificio_conjunto || _,
          linderos_especiales: inmueble.linderos || _,
          linderos_generales: inmueble.linderos || _,
          orip_ciudad: inmueble.codigo_orip || _,
          orip_zona: _,
          coeficiente_letras: _,
          coeficiente_numero: inmueble.coeficiente_copropiedad || _,
          nupre: inmueble.nupre || _,
          estrato: inmueble.estrato || _,
          es_rph: inmueble.es_propiedad_horizontal,
          predial_anio: extractedPredial?.anio_gravable || _,
          predial_num: extractedPredial?.numero_recibo || _,
          predial_valor: extractedPredial?.valor_pagado ? formatMonedaLegal(extractedPredial.valor_pagado) : _,
          idu_num: _, idu_fecha: _, idu_vigencia: _,
          admin_fecha: _, admin_vigencia: _,
        },

        // Actos nested
        actos: {
          cuantia_compraventa_letras: actos.valor_compraventa ? formatMonedaLegal(actos.valor_compraventa).split("($")[0]?.trim() || _ : _,
          cuantia_compraventa_numero: actos.valor_compraventa ? formatMonedaLegal(actos.valor_compraventa) : _,
          cuantia_hipoteca_letras: actos.valor_hipoteca ? formatMonedaLegal(actos.valor_hipoteca).split("($")[0]?.trim() || _ : _,
          cuantia_hipoteca_numero: actos.valor_hipoteca ? formatMonedaLegal(actos.valor_hipoteca) : _,
          fecha_escritura_letras: _,
          entidad_bancaria: actos.entidad_bancaria || _,
          entidad_nit: actos.entidad_nit || _,
          entidad_domicilio: actos.entidad_domicilio || _,
          pago_inicial_letras: actos.pago_inicial ? formatMonedaLegal(actos.pago_inicial).split("($")[0]?.trim() || _ : _,
          pago_inicial_numero: actos.pago_inicial ? formatMonedaLegal(actos.pago_inicial) : _,
          saldo_financiado_letras: actos.saldo_financiado ? formatMonedaLegal(actos.saldo_financiado).split("($")[0]?.trim() || _ : _,
          saldo_financiado_numero: actos.saldo_financiado ? formatMonedaLegal(actos.saldo_financiado) : _,
          credito_dia_letras: creditoFecha.dia_letras,
          credito_dia_num: creditoFecha.dia_num,
          credito_mes: creditoFecha.mes,
          credito_anio_letras: creditoFecha.anio_letras,
          credito_anio_num: creditoFecha.anio_num,
          redam_resultado: _,
          afectacion_vivienda: actos.afectacion_vivienda_familiar || false,
        },

        // Antecedentes
        antecedentes: {
          modo: extractedDocumento?.modo_adquisicion || _,
          adquirido_de: extractedDocumento?.adquirido_de || _,
          escritura_num_letras: _,
          escritura_num_numero: extractedDocumento?.titulo_antecedente?.numero_documento || extractedDocumento?.numero_escritura || _,
          escritura_dia_letras: antFecha.dia_letras,
          escritura_dia_num: antFecha.dia_num,
          escritura_mes: antFecha.mes,
          escritura_anio_letras: antFecha.anio_letras,
          escritura_anio_num: antFecha.anio_num,
          notaria_previa_numero: extractedDocumento?.titulo_antecedente?.notaria_documento || extractedDocumento?.notaria_origen || _,
          notaria_previa_circulo: extractedDocumento?.titulo_antecedente?.ciudad_documento || _,
        },

        // RPH
        rph: {
          escritura_num_letras: _,
          escritura_num_numero: inmueble.escritura_ph_numero || _,
          escritura_dia_letras: rphFecha.dia_letras,
          escritura_dia_num: rphFecha.dia_num,
          escritura_mes: rphFecha.mes,
          escritura_anio_letras: rphFecha.anio_letras,
          escritura_anio_num: rphFecha.anio_num,
          notaria_numero: inmueble.escritura_ph_notaria || _,
          notaria_ciudad: inmueble.escritura_ph_ciudad || _,
          matricula_matriz: inmueble.matricula_matriz || _,
        },

        // Apoderado banco
        apoderado_banco: {
          nombre: actos.apoderado_nombre || _,
          cedula: actos.apoderado_cedula ? formatCedulaLegal(actos.apoderado_cedula) : _,
          expedida_en: actos.apoderado_expedida_en || _,
          escritura_poder_num: actos.apoderado_escritura_poder || _,
          poder_dia_letras: _, poder_dia_num: _, poder_mes: _, poder_anio_letras: _, poder_anio_num: _,
          notaria_poder_num: actos.apoderado_notaria_poder || _,
          notaria_poder_ciudad: actos.apoderado_notaria_ciudad || _,
          email: actos.apoderado_email || _,
        },
      };

      doc.render(structuredData);

      let outZip = doc.getZip();
      // Apply text overrides to DOCX XML using robust virtualization
      if (overrides.length > 0) {
        const docXml = outZip.file("word/document.xml");
        if (docXml) {
          let xmlContent = docXml.asText();
          xmlContent = applyOverridesToDocx(xmlContent, overrides);
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

      // Persist a copy in private bucket so it can be re-downloaded later without re-running AI.
      // Path MUST start with tramiteId — Phase 1 RLS enforces tramite_org_from_path() on first segment.
      let uploadedPath: string | null = null;
      try {
        const path = `${tramiteId}/${Date.now()}-${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from("expediente-files")
          .upload(path, out, {
            contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            upsert: false,
          });
        if (uploadError) {
          console.warn("[generate] storage upload failed", uploadError);
          toast({
            title: "Documento descargado",
            description: "No se pudo guardar copia en la nube. Podrás regenerar cuando quieras.",
          });
        } else {
          uploadedPath = path;
        }
      } catch (uploadErr: any) {
        console.warn("[generate] storage upload exception", uploadErr);
      }

      await supabase
        .from("tramites")
        .update({ status: "word_generado", ...(uploadedPath ? { docx_path: uploadedPath } : {}) })
        .eq("id", tramiteId);
      if (uploadedPath) {
        setDocxPath(uploadedPath);
        setShowFinalView(true);
      }
      await refreshCredits();
      setIsDirty(false);
      setSyncStatus("saved");
      toast({ title: "¡Éxito!", description: "Documento generado. Revisa las sugerencias de la IA en el visor." });
    } catch (err: any) {
      if (isCreditsBlockedError(err)) {
        emitCreditsBlocked({ source: "process-expediente" });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      setGenerating(false);
      setGeneratingWord(false);
    }
  };

  // Re-descarga el .docx ya generado desde el bucket privado, sin consumir créditos
  // ni invocar al pipeline de IA. Usa una signed URL de corta duración.
  const handleRedownload = async () => {
    if (!docxPath) return;
    try {
      const { data, error } = await supabase.storage
        .from("expediente-files")
        .createSignedUrl(docxPath, 60);
      if (error || !data?.signedUrl) {
        toast({ title: "No se pudo descargar", description: error?.message ?? "URL no disponible", variant: "destructive" });
        return;
      }
      // Nombre amigable: el archivo en storage tiene timestamp por unicidad,
      // pero al usuario le entregamos un nombre legible.
      const tipo = (actos.tipo_acto || "Tramite").replace(/[^\p{L}\p{N}_-]+/gu, "_");
      const shortId = (tramiteId || "").slice(0, 8) || "doc";
      const friendlyName = `Escritura_${tipo}_${shortId}.docx`;

      const resp = await fetch(data.signedUrl);
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = friendlyName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast({ title: "Descarga lista", description: "Sin consumo de créditos." });
    } catch (e: any) {
      toast({ title: "Error al descargar", description: e?.message ?? String(e), variant: "destructive" });
    }
  };

  const syncIndicator = () => {
    let Icon: typeof Cloud = Cloud;
    let label = "Sin cambios pendientes";
    let className = "text-white/60";
    let spin = false;
    if (syncStatus === "saving") {
      Icon = Loader2;
      label = "Guardando…";
      className = "text-white/80";
      spin = true;
    } else if (syncStatus === "saved") {
      Icon = Check;
      label = "Guardado · hace un momento";
      className = "text-notarial-green";
    } else if (syncStatus === "unsaved") {
      Icon = CloudOff;
      label = "Sin guardar";
      className = "text-notarial-gold";
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${className}`} aria-label={label}>
            <Icon className={`h-4 w-4 ${spin ? "animate-spin" : ""}`} />
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border-white/10 text-white text-xs px-2.5 py-1.5">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderTabs = () => {
    // Helper: pick highest-severity validation for a tab
    const getTabSeverity = (tabKey: string) => {
      if (!validacionCampos?.validaciones?.length) return null;
      const matches = validacionCampos.validaciones.filter(v =>
        v.campo?.startsWith(`${tabKey}.`) || v.campo === tabKey ||
        v.campos_relacionados?.some(c => c.startsWith(`${tabKey}.`))
      );
      if (!matches.length) return null;
      const order = { error: 3, advertencia: 2, sugerencia: 1 } as const;
      const top = matches.reduce((a, b) =>
        (order[b.nivel as keyof typeof order] || 0) > (order[a.nivel as keyof typeof order] || 0) ? b : a
      );
      return { nivel: top.nivel, explicacion: top.explicacion, count: matches.length };
    };

    const renderTabIcon = (tabKey: string) => {
      const sev = getTabSeverity(tabKey);
      if (!sev) return null;
      const Icon = sev.nivel === "error" ? AlertCircle : sev.nivel === "advertencia" ? AlertTriangle : Info;
      const colorCls = sev.nivel === "error" ? "text-destructive" : sev.nivel === "advertencia" ? "text-accent" : "text-primary";
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Icon className={`h-3.5 w-3.5 ml-1.5 ${colorCls}`} />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">{sev.explicacion}</p>
              {sev.count > 1 && <p className="text-[10px] opacity-70 mt-1">+{sev.count - 1} más</p>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    };

    const conteo = validacionCampos ? contarPorNivel(validacionCampos) : null;
    const totalHallazgos = conteo ? conteo.errores + conteo.advertencias + conteo.sugerencias : 0;

    // Sugerencias de notaría detectadas por Claude (auto-corregibles, campo notaria_tramite.*)
    const NOTARIA_FIELDS: Array<keyof NotariaTramite> = [
      "numero_notaria", "numero_notaria_letras", "numero_ordinal", "circulo",
      "departamento", "nombre_notario", "tipo_notario", "decreto_nombramiento", "genero_notario",
    ];
    const NOTARIA_LABELS: Record<keyof NotariaTramite, string> = {
      numero_notaria: "Número de notaría",
      numero_notaria_letras: "Número en letras (QUINTA, VEINTIUNA…)",
      numero_ordinal: "Ordinal (5.ª, 21.ª…)",
      circulo: "Círculo notarial",
      departamento: "Departamento",
      nombre_notario: "Nombre del notario",
      tipo_notario: "Tipo (TITULAR / ENCARGADO / INTERINO)",
      decreto_nombramiento: "Decreto / Resolución",
      genero_notario: "Género (MASCULINO / FEMENINO)",
    };
    const notariaSuggestions = new Map<keyof NotariaTramite, string>();
    if (validacionCampos?.validaciones) {
      for (const v of validacionCampos.validaciones) {
        if (!v.auto_corregible || !v.valor_sugerido) continue;
        const m = (v.campo || "").match(/^notaria(?:_tramite)?\.(.+)$/);
        if (!m) continue;
        const key = m[1] as keyof NotariaTramite;
        if (!NOTARIA_FIELDS.includes(key)) continue;
        if (ignoredNotariaSuggestions.has(`${key}=${v.valor_sugerido}`)) continue;
        if (notariaTramite[key]) continue; // ya tiene valor: no sugerir
        if (!notariaSuggestions.has(key)) notariaSuggestions.set(key, v.valor_sugerido);
      }
    }

    const applyNotariaSuggestion = (key: keyof NotariaTramite, value: string) => {
      setNotariaTramite(prev => ({ ...prev, [key]: value }));
      setIgnoredNotariaSuggestions(prev => new Set(prev).add(`${key}=${value}`));
    };
    const ignoreNotariaSuggestion = (key: keyof NotariaTramite, value: string) => {
      setIgnoredNotariaSuggestions(prev => new Set(prev).add(`${key}=${value}`));
    };
    const applyAllNotariaSuggestions = () => {
      const updates: Partial<NotariaTramite> = {};
      const newIgnored = new Set(ignoredNotariaSuggestions);
      notariaSuggestions.forEach((value, key) => {
        updates[key] = value as any;
        newIgnored.add(`${key}=${value}`);
      });
      setNotariaTramite(prev => ({ ...prev, ...updates }));
      setIgnoredNotariaSuggestions(newIgnored);
    };

    // Handler especial para `numero_notaria` que también re-deriva letras y ordinal
    // (excepto si el usuario ya los marcó como manuales).
    const updateNumeroNotaria = (raw: string) => {
      const cleaned = raw.replace(/\D/g, "").slice(0, 4);
      setNotariaTramite(prev => {
        const next: NotariaTramite = { ...prev, numero_notaria: cleaned };
        if (cleaned) {
          if (!notariaManualOverrides.has("numero_notaria_letras")) {
            next.numero_notaria_letras = numeroNotariaToLetras(cleaned);
          }
          if (!notariaManualOverrides.has("numero_ordinal")) {
            next.numero_ordinal = numeroToOrdinalAbbr(cleaned, formatoOrdinalNotaria);
          }
        } else {
          // Cascading cleanup: si se borra el número, se limpia TODO (incluso overrides
          // manuales) para forzar reinicio total de coherencia notarial.
          next.numero_notaria_letras = "";
          next.numero_ordinal = "";
        }
        return next;
      });
      if (!cleaned) {
        setNotariaManualOverrides(prev => {
          const n = new Set(prev);
          n.delete("numero_notaria_letras");
          n.delete("numero_ordinal");
          return n;
        });
      }
    };

    const updateDerivado = (key: "numero_notaria_letras" | "numero_ordinal", value: string) => {
      // ── Sincronización bidireccional ──
      // Si el usuario edita "En letras" y el texto coincide con un número conocido,
      // re-derivamos `numero_notaria` y, si el ordinal NO está marcado como manual,
      // también lo re-generamos para mantener coherencia visual entre los 3 campos.
      if (key === "numero_notaria_letras") {
        const inferido = letrasNotariaToNumero(value);
        if (inferido !== null) {
          const nStr = String(inferido);
          setNotariaTramite(prev => {
            const next: NotariaTramite = {
              ...prev,
              numero_notaria: nStr,
              numero_notaria_letras: numeroNotariaToLetras(inferido), // canónico (MAYÚSCULAS)
            };
            if (!notariaManualOverrides.has("numero_ordinal")) {
              next.numero_ordinal = numeroToOrdinalAbbr(inferido, formatoOrdinalNotaria);
            }
            return next;
          });
          // El valor en letras ahora es canónico, no es "edición manual" en strict sense.
          setNotariaManualOverrides(prev => {
            const n = new Set(prev);
            n.delete("numero_notaria_letras");
            return n;
          });
          return;
        }
      }

      setNotariaTramite(prev => ({ ...prev, [key]: value }));
      setNotariaManualOverrides(prev => {
        const n = new Set(prev);
        if (value) n.add(key);
        else n.delete(key);
        return n;
      });
    };

    const regenerarDerivado = (key: "numero_notaria_letras" | "numero_ordinal") => {
      const num = notariaTramite.numero_notaria;
      if (!num) return;
      const auto = key === "numero_notaria_letras"
        ? numeroNotariaToLetras(num)
        : numeroToOrdinalAbbr(num, formatoOrdinalNotaria);
      setNotariaTramite(prev => ({ ...prev, [key]: auto }));
      setNotariaManualOverrides(prev => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
    };

    // El switch de formato (5.ª / 5ta) SIEMPRE re-deriva el ordinal y limpia
    // cualquier override manual sobre `numero_ordinal`. Razón UX: el formato es
    // una decisión visual global; un override manual con notación contraria al
    // formato seleccionado rompe la coherencia del documento.
    const cambiarFormatoOrdinal = (nuevo: FormatoOrdinal) => {
      setFormatoOrdinalNotaria(nuevo);
      if (notariaTramite.numero_notaria) {
        setNotariaTramite(prev => ({
          ...prev,
          numero_ordinal: numeroToOrdinalAbbr(prev.numero_notaria, nuevo),
        }));
        setNotariaManualOverrides(prev => {
          const n = new Set(prev);
          n.delete("numero_ordinal");
          return n;
        });
      }
    };

    // Mapa de claves de NotariaTramite → atributo `data-field-input` que usa
    // `onScrollToField` para enfocar el input desde el preview.
    const NOTARIA_INPUT_ATTR: Partial<Record<keyof NotariaTramite, string>> = {
      numero_notaria: "notaria_numero",
      numero_notaria_letras: "notaria_numero_letras",
      numero_ordinal: "notaria_ordinal",
      circulo: "notaria_circulo",
      departamento: "notaria_departamento",
    };

    const renderNotariaInput = (key: keyof NotariaTramite) => {
      const sug = notariaSuggestions.get(key);
      const dataAttr = NOTARIA_INPUT_ATTR[key];
      const input = (
        <input
          type="text"
          value={notariaTramite[key]}
          onChange={(e) => setNotariaTramite(prev => ({ ...prev, [key]: e.target.value }))}
          placeholder="___________"
          data-field-input={dataAttr}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      );
      if (!sug) return input;
      return (
        <OcrSuggestion
          value={sug}
          onConfirm={() => applyNotariaSuggestion(key, sug)}
          onIgnore={() => ignoreNotariaSuggestion(key, sug)}
        >
          <div className="ring-2 ring-primary/40 rounded-md">{input}</div>
        </OcrSuggestion>
      );
    };

    const camposLlenos = NOTARIA_FIELDS.filter(k => notariaTramite[k]).length;
    // Campos del bloque número (manejados por la sub-tarjeta especial)
    const NUMERO_BLOCK_KEYS = new Set<keyof NotariaTramite>(["numero_notaria", "numero_notaria_letras", "numero_ordinal"]);
    const OTROS_NOTARIA_FIELDS = NOTARIA_FIELDS.filter(k => !NUMERO_BLOCK_KEYS.has(k));

    // Vista previa del bloque tal como aparecerá en el documento: "QUINTA (5.ª)"
    const previewLetras = notariaTramite.numero_notaria_letras
      || (notariaTramite.numero_notaria ? numeroNotariaToLetras(notariaTramite.numero_notaria) : "");
    const previewOrdinal = notariaTramite.numero_ordinal
      || (notariaTramite.numero_notaria ? numeroToOrdinalAbbr(notariaTramite.numero_notaria, formatoOrdinalNotaria) : "");

    // Indicadores de "valor automático (placeholder)" vs "valor manual"
    const letrasAutomatico = !notariaTramite.numero_notaria_letras && !!notariaTramite.numero_notaria;
    const ordinalAutomatico = !notariaTramite.numero_ordinal && !!notariaTramite.numero_notaria;

    // Coherencia notarial: campos críticos para que el documento no salga con líneas en blanco
    const camposCriticosFaltantes: string[] = [];
    if (!notariaTramite.numero_notaria) camposCriticosFaltantes.push("Número de notaría");
    if (!notariaTramite.circulo) camposCriticosFaltantes.push("Círculo notarial");
    if (!notariaTramite.departamento) camposCriticosFaltantes.push("Departamento");
    const notariaIncompleta = camposCriticosFaltantes.length > 0;

    return (
    <Tabs defaultValue="vendedores" className="w-full">
      {/* Panel: Datos de la Notaría (POR TRÁMITE) */}
      <div className="mb-4 rounded-md border border-border/60 bg-card">
        <button
          type="button"
          onClick={() => setNotariaPanelOpen(v => !v)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Datos de la Notaría</span>
            <span className="text-xs text-muted-foreground">
              ({camposLlenos}/{NOTARIA_FIELDS.length} campos)
            </span>
            {notariaSuggestions.size > 0 && (
              <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
                {notariaSuggestions.size} sugerencia{notariaSuggestions.size !== 1 ? "s" : ""} de IA
              </Badge>
            )}
          </div>
          {notariaPanelOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {notariaPanelOpen && (
          <div className="border-t border-border/40 p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Estos datos se usan para llenar las referencias a la notaría en la escritura.
              Si los dejas vacíos, el documento mostrará líneas en blanco (___________).
            </p>
            {notariaSuggestions.size > 0 && (
              <div className="flex items-center justify-between gap-2 rounded bg-primary/5 border border-primary/20 px-2 py-1.5">
                <span className="text-xs text-foreground">
                  El asistente IA detectó {notariaSuggestions.size} dato{notariaSuggestions.size !== 1 ? "s" : ""} de notaría en los documentos cargados.
                </span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={applyAllNotariaSuggestions}>
                  Aplicar todas
                </Button>
              </div>
            )}

            {/* ── Bloque único: Número de Notaría (genera letras y ordinal) ── */}
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Número de notaría <span className="text-muted-foreground font-normal">— genera letras y ordinal</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={notariaTramite.numero_notaria}
                  onChange={(e) => updateNumeroNotaria(e.target.value)}
                  placeholder="65"
                  data-field-input="notaria_numero"
                  className="w-32 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div className="border-l-2 border-primary/30 pl-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Derivados — editables
                  </span>
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-muted-foreground">Formato:</span>
                    <button
                      type="button"
                      onClick={() => cambiarFormatoOrdinal("volada")}
                      className={`px-1.5 py-0.5 rounded border transition-colors ${
                        formatoOrdinalNotaria === "volada"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      5.ª
                    </button>
                    <button
                      type="button"
                      onClick={() => cambiarFormatoOrdinal("to")}
                      className={`px-1.5 py-0.5 rounded border transition-colors ${
                        formatoOrdinalNotaria === "to"
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      5ta
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">En letras</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={notariaTramite.numero_notaria_letras}
                        onChange={(e) => updateDerivado("numero_notaria_letras", e.target.value.toLocaleUpperCase("es-CO"))}
                        placeholder={notariaTramite.numero_notaria ? numeroNotariaToLetras(notariaTramite.numero_notaria) : "Ingresa el número primero"}
                        data-field-input="notaria_numero_letras"
                        className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      {notariaManualOverrides.has("numero_notaria_letras") && notariaTramite.numero_notaria && (
                        <button
                          type="button"
                          onClick={() => regenerarDerivado("numero_notaria_letras")}
                          title="Regenerar desde el número"
                          className="text-muted-foreground hover:text-primary p-1"
                        >
                          ↻
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Abreviatura ordinal</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={notariaTramite.numero_ordinal}
                        onChange={(e) => updateDerivado("numero_ordinal", e.target.value)}
                        placeholder={notariaTramite.numero_notaria ? numeroToOrdinalAbbr(notariaTramite.numero_notaria, formatoOrdinalNotaria) : "Ingresa el número primero"}
                        data-field-input="notaria_ordinal"
                        className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      {notariaManualOverrides.has("numero_ordinal") && notariaTramite.numero_notaria && (
                        <button
                          type="button"
                          onClick={() => regenerarDerivado("numero_ordinal")}
                          title="Regenerar desde el número"
                          className="text-muted-foreground hover:text-primary p-1"
                        >
                          ↻
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {(previewLetras || previewOrdinal) && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
                    <span>En el documento aparecerá como:</span>
                    <span className="font-semibold text-foreground bg-primary/10 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                      <span className={letrasAutomatico ? "italic text-notarial-gold" : ""}>
                        {previewLetras || "___"}
                      </span>
                      <span className="text-muted-foreground">(</span>
                      <span className={ordinalAutomatico ? "italic text-notarial-gold" : ""}>
                        {previewOrdinal || "___"}
                      </span>
                      <span className="text-muted-foreground">)</span>
                      {(letrasAutomatico || ordinalAutomatico) && (
                        <Sparkles className="h-3 w-3 text-notarial-gold" />
                      )}
                    </span>
                    {(letrasAutomatico || ordinalAutomatico) && (
                      <span className="text-[10px] italic text-notarial-gold/80">
                        — valor automático del número
                      </span>
                    )}
                  </p>
                )}

                {/* Guard de coherencia notarial */}
                {notariaIncompleta && (
                  <Alert variant="destructive" className="py-2 mt-1">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="text-xs font-semibold">[Dato Faltante]</AlertTitle>
                    <AlertDescription className="text-[11px]">
                      Faltan campos críticos: <strong>{camposCriticosFaltantes.join(", ")}</strong>.
                      No podrás previsualizar hasta completarlos para evitar documentos con líneas en blanco.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>

            {/* Demás campos de notaría */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {OTROS_NOTARIA_FIELDS.map(key => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{NOTARIA_LABELS[key]}</label>
                  {renderNotariaInput(key)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <TabsList className="mb-3 w-full">
        <TabsTrigger value="vendedores" className="flex-1">Vendedores{renderTabIcon("vendedores")}</TabsTrigger>
        <TabsTrigger value="compradores" className="flex-1">Compradores{renderTabIcon("compradores")}</TabsTrigger>
        <TabsTrigger value="inmueble" className="flex-1">Inmueble{renderTabIcon("inmueble")}</TabsTrigger>
        <TabsTrigger value="actos" className="flex-1">Actos{renderTabIcon("actos")}</TabsTrigger>
      </TabsList>

      {validandoCampos && (
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Validando coherencia con asistente IA...
        </div>
      )}

      {validacionCampos && totalHallazgos > 0 && (
        <div className="mb-4 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setBannerExpanded(v => !v)}
              className="flex items-center gap-2 text-xs text-foreground hover:text-primary transition-colors flex-1 text-left"
            >
              <Info className="h-3.5 w-3.5 text-primary" />
              <span>
                {conteo!.errores > 0 && <span className="text-destructive font-medium">{conteo!.errores} error{conteo!.errores !== 1 ? "es" : ""}</span>}
                {conteo!.errores > 0 && (conteo!.advertencias > 0 || conteo!.sugerencias > 0) && <span>, </span>}
                {conteo!.advertencias > 0 && <span className="text-accent font-medium">{conteo!.advertencias} advertencia{conteo!.advertencias !== 1 ? "s" : ""}</span>}
                {conteo!.advertencias > 0 && conteo!.sugerencias > 0 && <span>, </span>}
                {conteo!.sugerencias > 0 && <span>{conteo!.sugerencias} sugerencia{conteo!.sugerencias !== 1 ? "s" : ""}</span>}
                <span className="text-muted-foreground"> tras la última carga</span>
              </span>
              {bannerExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setValidacionCampos(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Descartar"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {bannerExpanded && (
            <ul className="mt-2 space-y-1.5 border-t border-border/40 pt-2">
              {validacionCampos.validaciones.map((v, idx) => {
                const Icon = v.nivel === "error" ? AlertCircle : v.nivel === "advertencia" ? AlertTriangle : Info;
                const colorCls = v.nivel === "error" ? "text-destructive" : v.nivel === "advertencia" ? "text-accent" : "text-primary";
                return (
                  <li key={idx} className="flex items-start gap-2 text-xs">
                    <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${colorCls}`} />
                    <div className="flex-1">
                      <span className="font-medium text-foreground">{v.campo}</span>
                      <span className="text-muted-foreground"> · {v.explicacion}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <TabsContent value="vendedores">
        <PersonaForm title="Vendedores" personas={vendedores} onChange={setVendedores} confianzaFields={confianzaFields} onConfianzaChange={handleConfianzaChange} hasEscrituraProcessed={!!(tramiteMetadata?.extracted_escritura_comparecientes?.length > 0 || tramiteMetadata?.extracted_documento)} />
      </TabsContent>
      <TabsContent value="compradores">
        <PersonaForm title="Compradores" personas={compradores} onChange={setCompradores} confianzaFields={confianzaFields} onConfianzaChange={handleConfianzaChange} hasEscrituraProcessed={!!(tramiteMetadata?.extracted_escritura_comparecientes?.length > 0 || tramiteMetadata?.extracted_documento)} />
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
          metadata={tramiteMetadata}
        />
      </TabsContent>
      <TabsContent value="actos">
        <ActosForm actos={actos} onChange={setActos} />
      </TabsContent>
    </Tabs>
    );
  };

  // Coherencia notarial — guard a nivel global para el botón Previsualizar.
  const camposCriticosFaltantesGlobal: string[] = [];
  if (!notariaTramite.numero_notaria) camposCriticosFaltantesGlobal.push("Número de notaría");
  if (!notariaTramite.circulo) camposCriticosFaltantesGlobal.push("Círculo notarial");
  if (!notariaTramite.departamento) camposCriticosFaltantesGlobal.push("Departamento");
  const notariaIncompletaGlobal = camposCriticosFaltantesGlobal.length > 0;

  return (
    <div className="flex h-dvh flex-col bg-background lg:overflow-hidden overflow-auto">
      <header className="sticky top-0 z-50 h-12 shrink-0 border-b border-white/5 bg-notarial-dark/80 backdrop-blur-md text-white">
        <TooltipProvider delayDuration={200}>
          <div className="flex h-full items-center justify-between px-4">
            {/* Izquierda */}
            <div className="flex items-center gap-x-3 min-w-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost-dark"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleBack}
                    aria-label="Volver al dashboard"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border-white/10 text-white text-xs px-2.5 py-1.5">
                  Dashboard
                </TooltipContent>
              </Tooltip>

              <span className="text-sm font-medium text-white/90 whitespace-nowrap">Validación</span>
              <span className="text-white/30 select-none">·</span>

              {/* Chip Radicado */}
              {editingRadicado ? (
                <Input
                  autoFocus
                  value={radicadoDraft}
                  onChange={(e) => setRadicadoDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      setRadicadoDraft(radicado);
                      setEditingRadicado(false);
                    }
                  }}
                  onBlur={async () => {
                    const trimmed = radicadoDraft.trim();
                    setEditingRadicado(false);
                    if (trimmed === radicado || !tramiteId) return;
                    setSavingRadicado(true);
                    setSyncStatus("saving");
                    const { error } = await supabase
                      .from("tramites")
                      .update({ radicado: trimmed || null })
                      .eq("id", tramiteId);
                    setSavingRadicado(false);
                    if (error) {
                      setSyncStatus("unsaved");
                      toast({ title: "No se pudo guardar el radicado", description: error.message, variant: "destructive" });
                      setRadicadoDraft(radicado);
                    } else {
                      setRadicado(trimmed);
                      setSyncStatus("saved");
                    }
                  }}
                  placeholder="2026-0001"
                  disabled={savingRadicado}
                  className="h-8 w-[180px] bg-white/10 border-white/20 text-white placeholder:text-white/40 text-sm px-3"
                />
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setEditingRadicado(true)}
                      className="group flex h-8 w-[180px] items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:bg-white/10"
                    >
                      <span className={`truncate ${radicado ? "text-white" : "text-white/40 italic"}`}>
                        {radicado || "[Sin Radicado]"}
                      </span>
                      <Edit3 className="h-3 w-3 text-white/60 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border-white/10 text-white text-xs px-2.5 py-1.5">
                    Editar radicado
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Derecha */}
            <div className="flex items-center gap-x-4">
              {/* Documentos */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setShowDocPanel(true)}
                    className="flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white transition-colors hover:bg-white/10"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span>{expedienteDocs.filter(d => d.status === "procesado").length}/{expedienteDocs.length}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border-white/10 text-white text-xs px-2.5 py-1.5">
                  Gestión de Expediente ({expedienteDocs.filter(d => d.status === "procesado").length} de {expedienteDocs.length} documentos)
                </TooltipContent>
              </Tooltip>

              {/* Créditos */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white">
                    <Coins className="h-4 w-4 text-notarial-gold" />
                    <span>{credits}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border-white/10 text-white text-xs px-2.5 py-1.5">
                  Créditos disponibles
                </TooltipContent>
              </Tooltip>

              {/* Sync */}
              {syncIndicator()}

              {/* Guardar */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost-dark"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleSave}
                    disabled={saving}
                    aria-label="Guardar borrador"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border-white/10 text-white text-xs px-2.5 py-1.5">
                  Guardar borrador ahora
                </TooltipContent>
              </Tooltip>

              {/* Re-descarga sin créditos (solo si ya hay docx generado) */}
              {docxPath && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={handleRedownload}
                      className="h-9 px-4 border-notarial-gold/40 bg-white/5 text-notarial-gold hover:bg-notarial-gold/10"
                    >
                      <Download className="mr-1 h-4 w-4" /> Descargar Word
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border-white/10 text-white text-xs px-2.5 py-1.5">
                    Re-descargar el documento generado (sin consumir créditos)
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Previsualizar (primario) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={notariaIncompletaGlobal ? 0 : -1}>
                    <Button
                      onClick={handlePrevisualizar}
                      disabled={validando || notariaIncompletaGlobal}
                      className="h-9 px-6 bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90 font-medium disabled:opacity-60"
                    >
                      {validando ? (
                        <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Validando…</>
                      ) : (
                        <><Eye className="mr-1 h-4 w-4" /> Previsualizar</>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                {notariaIncompletaGlobal && (
                  <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border-destructive/40 text-white text-xs px-2.5 py-1.5 max-w-[260px]">
                    <p className="font-semibold text-destructive mb-0.5">Datos de notaría incompletos</p>
                    <p className="opacity-90">Faltan: {camposCriticosFaltantesGlobal.join(", ")}.</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>
      </header>

      {/* Documents Panel (Sheet) */}
      <Sheet open={showDocPanel} onOpenChange={setShowDocPanel}>
        <SheetContent side="right" className="w-[400px] sm:w-[400px] p-0 flex flex-col h-full [&>button]:z-50">
          <ExpedienteSidebar
            documentos={expedienteDocs}
            onUploadDocument={handleSidebarUpload}
            onReplaceDocument={handleSidebarReplace}
            onDeleteDocument={handleSidebarDelete}
            onAddCedula={handleSidebarAddCedula}
            onToggleChange={handleToggleChange}
            toggles={docToggles}
            uploading={sidebarUploading}
          />
        </SheetContent>
      </Sheet>

      {/* Desktop: split view */}
      <div className="flex-1 min-h-0 hidden lg:flex">
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={50} minSize={30} className="min-h-0 overflow-hidden">
            <div className="flex flex-col h-full">
              {docxPath && (
                <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 bg-slate-950/60 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowFinalView(false)}
                    className={`px-3 py-1 text-xs rounded-md transition ${!showFinalView ? "bg-notarial-gold text-notarial-dark font-semibold" : "text-white/60 hover:text-white"}`}
                  >
                    Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFinalView(true)}
                    className={`px-3 py-1 text-xs rounded-md transition ${showFinalView ? "bg-notarial-gold text-notarial-dark font-semibold" : "text-white/60 hover:text-white"}`}
                  >
                    Vista final
                  </button>
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-hidden">
                {docxPath && showFinalView ? (
                  <PdfViewerPane tramiteId={tramiteId ?? ""} docxPath={docxPath} />
                ) : (
                  <DocxPreview
                    vendedores={vendedores}
                    compradores={compradores}
                    inmueble={inmueble}
                    actos={actos}
                    overrides={overrides}
                    manualFieldOverrides={manualFieldOverrides}
                    onFieldEdit={handleFieldEdit}
                    onCreateOverride={handleCreateOverride}
                    onRemoveOverride={handleRemoveOverride}
                    sugerenciasIA={sugerenciasIA}
                    generating={generatingWord}
                    textoFinalWord={textoFinalWord}
                    onSugerenciaAccepted={handleSugerenciaAccepted}
                    notariaConfig={notariaConfig}
                    notariaTramite={notariaTramite}
                    extractedDocumento={extractedDocumento}
                    extractedPredial={extractedPredial}
                    slotsPendientes={slotsPendientes}
                    onScrollToField={onScrollToField}
                  />
                )}
              </div>
            </div>
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
      </div>

      {/* Mobile: stacked column */}
      <div className="flex-1 flex flex-col lg:hidden overflow-auto">
        <div className="container max-w-2xl py-6 pb-20">
          {renderTabs()}
        </div>
        {/* Floating preview button for mobile */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              className="fixed bottom-4 right-4 lg:hidden z-50 rounded-full shadow-lg bg-notarial-gold text-notarial-dark hover:bg-notarial-gold/90 h-14 w-14"
              size="icon"
            >
              <Eye className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[80vh] p-0">
            <DocxPreview
              vendedores={vendedores}
              compradores={compradores}
              inmueble={inmueble}
              actos={actos}
              overrides={overrides}
              manualFieldOverrides={manualFieldOverrides}
              onFieldEdit={handleFieldEdit}
              onCreateOverride={handleCreateOverride}
              onRemoveOverride={handleRemoveOverride}
              sugerenciasIA={sugerenciasIA}
              generating={generatingWord}
              textoFinalWord={textoFinalWord}
              onSugerenciaAccepted={handleSugerenciaAccepted}
              notariaConfig={notariaConfig}
              notariaTramite={notariaTramite}
              extractedDocumento={extractedDocumento}
              extractedPredial={extractedPredial}
              slotsPendientes={slotsPendientes}
              onScrollToField={onScrollToField}
            />
          </SheetContent>
        </Sheet>
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
