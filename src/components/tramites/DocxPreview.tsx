import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { lookupBank } from "@/lib/bankDirectory";
import { formatMonedaLegal, formatFechaLegal, formatCedulaLegal, numeroNotariaToLetras, numeroToOrdinalAbbr, detectarFormatoOrdinal } from "@/lib/legalFormatters";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, ChevronLeft, ChevronRight, AlertTriangle, Palette, Check, X, Info, Pencil, Undo2 } from "lucide-react";
import type { Persona, Inmueble, Actos, TextOverride, SugerenciaIA } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import VariableEditPopover from "./VariableEditPopover";
import InlineEditToolbar from "./InlineEditToolbar";
import DOMPurify from "dompurify";
import mammoth from "mammoth";

// Whitelist de campos con destino real en el formulario lateral.
// Solo estos muestran el atajo "Ir al formulario" en el popover de edición.
const FORM_FIELDS = new Set<string>([
  // Inmueble
  "inmueble.direccion", "inmueble.matricula", "inmueble.cedula_catastral",
  "inmueble.linderos_especiales", "inmueble.linderos_generales",
  "inmueble.avaluo_catastral", "inmueble.estrato", "inmueble.orip_ciudad",
  "matricula_inmobiliaria", "identificador_predial", "direccion_inmueble",
  "municipio", "departamento", "area", "linderos", "avaluo_catastral",
  "estrato", "codigo_orip",
  // Actos
  "actos.cuantia_compraventa_letras", "actos.cuantia_compraventa_numero",
  "actos.entidad_bancaria", "actos.entidad_nit", "actos.entidad_domicilio",
  "tipo_acto", "entidad_bancaria", "valor_compraventa_letras",
  "valor_hipoteca_letras",
  // Comparecientes
  "comparecientes_vendedor", "comparecientes_comprador",
]);

// ── Number to words (Spanish) ──────────────────────────────────
const UNITS = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const TEENS = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
const TENS = ["", "DIEZ", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const HUNDREDS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function numberToWords(input: string): string {
  // Clean: remove $, dots, spaces, commas
  const cleaned = input.replace(/[$.\s]/g, "").replace(/,/g, "");
  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num <= 0) return "";
  if (num === 100) return "CIEN";

  const convertGroup = (n: number): string => {
    if (n === 0) return "";
    if (n === 100) return "CIEN";
    if (n < 10) return UNITS[n];
    if (n < 20) return TEENS[n - 10];
    if (n < 30) return n === 20 ? "VEINTE" : `VEINTI${UNITS[n % 10]}`;
    if (n < 100) {
      const t = Math.floor(n / 10), u = n % 10;
      return u === 0 ? TENS[t] : `${TENS[t]} Y ${UNITS[u]}`;
    }
    const h = Math.floor(n / 100), rest = n % 100;
    if (h === 1 && rest === 0) return "CIEN";
    return rest === 0 ? HUNDREDS[h] : `${HUNDREDS[h]} ${convertGroup(rest)}`;
  };

  const groups: [number, string, string][] = [
    [1_000_000_000, "MIL MILLONES", "MIL MILLONES"],
    [1_000_000, "MILLÓN", "MILLONES"],
    [1_000, "MIL", "MIL"],
    [1, "", ""],
  ];

  let result = "";
  let remaining = num;
  for (const [divisor, singular, plural] of groups) {
    const q = Math.floor(remaining / divisor);
    remaining = remaining % divisor;
    if (q === 0) continue;
    if (divisor === 1) {
      result += ` ${convertGroup(q)}`;
    } else if (q === 1) {
      result += divisor === 1000 ? ` MIL` : ` UN ${singular}`;
    } else {
      result += ` ${convertGroup(q)} ${plural}`;
    }
  }
  return (result.trim() + " PESOS M/CTE").replace(/\s+/g, " ");
}

// ── Parse structured text like "ESCRITURA 5035 DEL 07-09-2018 NOTARÍA VEINTIOCHO" ──
function parseEscrituraString(text: string | undefined): {
  numero?: string; dia?: string; mes?: string; anio?: string; notaria?: string;
} {
  if (!text) return {};
  const numMatch = text.match(/(?:ESCRITURA|ESC\.?)\s*(?:NO?\.?\s*)?(\d+)/i);
  const dateMatch = text.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);
  const notariaMatch = text.match(/NOTAR[IÍ]A\s+(.+?)(?:\s+DE\s+|$)/i);
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return {
    numero: numMatch?.[1],
    dia: dateMatch?.[1],
    mes: dateMatch ? meses[parseInt(dateMatch[2], 10) - 1] || dateMatch[2] : undefined,
    anio: dateMatch?.[3],
    notaria: notariaMatch?.[1]?.trim(),
  };
}

// Robust date parser for DD-MM-AAAA format (OCR returns this format)
function parseFechaDoc(f?: string): { dia?: string; mes?: string; anio?: string } {
  if (!f) return {};
  const m = f.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);
  if (m) {
    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    return { dia: m[1], mes: meses[parseInt(m[2], 10) - 1], anio: m[3] };
  }
  // Try YYYY-MM-DD
  const iso = f.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
  if (iso) {
    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    return { dia: iso[3], mes: meses[parseInt(iso[2], 10) - 1], anio: iso[1] };
  }
  return {};
}

interface NotariaConfig {
  nombre_notaria: string; ciudad: string; notario_titular: string; estilo_linderos: string;
  numero_notaria: number | null; circulo: string; departamento: string; tipo_notario: string;
  nombre_notario: string; decreto_nombramiento: string;
}

export interface NotariaTramite {
  numero_notaria: string;          // "5", "21"
  numero_notaria_letras: string;   // "QUINTA", "VEINTIUNA"
  numero_ordinal: string;          // "5o", "21a"
  circulo: string;                 // "BOGOTÁ D.C."
  departamento: string;            // "CUNDINAMARCA"
  nombre_notario: string;
  tipo_notario: string;            // "TITULAR" (vacío en docx) | "ENCARGADO" | "INTERINO"
  decreto_nombramiento: string;
  genero_notario: string;          // "MASCULINO" | "FEMENINO"
}

export const createEmptyNotariaTramite = (): NotariaTramite => ({
  numero_notaria: "",
  numero_notaria_letras: "",
  numero_ordinal: "",
  circulo: "",
  departamento: "",
  nombre_notario: "",
  tipo_notario: "",
  decreto_nombramiento: "",
  genero_notario: "",
});

// QUINTO -> QUINTA, PRIMERO -> PRIMERA, etc. (best-effort para ordinales españoles)
const deriveFemenino = (s: string): string => {
  if (!s) return "";
  const upper = s.toUpperCase().trim();
  if (upper.endsWith("O")) return upper.slice(0, -1) + "A";
  return upper;
};

const toProperCase = (s: string): string => {
  if (!s) return "";
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((part) => /^\s+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
};

interface ExtractedDocumento {
  notaria_origen?: string; numero_escritura?: string; fecha_documento?: string;
  modo_adquisicion?: string; adquirido_de?: string;
  titulo_antecedente?: {
    tipo_documento?: string; numero_documento?: string; fecha_documento?: string;
    notaria_documento?: string; ciudad_documento?: string; adquirido_de?: string;
  };
}

interface ExtractedPredial {
  numero_recibo?: string; anio_gravable?: string; valor_pagado?: string; estrato?: string;
}

interface DocxPreviewProps {
  vendedores: Persona[];
  compradores: Persona[];
  inmueble: Inmueble;
  actos: Actos;
  overrides?: TextOverride[];
  manualFieldOverrides?: Record<string, string>;
  onFieldEdit?: (field: string, value: string, anchorText?: string) => void;
  onCreateOverride?: (originalText: string, newText: string, replaceAll: boolean, contextBefore: string, contextAfter: string) => void;
  onRemoveOverride?: (id: string) => void;
  sugerenciasIA?: SugerenciaIA[];
  generating?: boolean;
  textoFinalWord?: string;
  onSugerenciaAccepted?: (idx: number, textoSugerido: string) => void;
  notariaConfig?: NotariaConfig | null;
  notariaTramite?: NotariaTramite | null;
  extractedDocumento?: ExtractedDocumento | null;
  extractedPredial?: ExtractedPredial | null;
  slotsPendientes?: string[];
  onScrollToField?: (field: string) => void;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_PADDING_X = 72;
const PAGE_PADDING_Y = 72;
const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING_Y * 2;
const NAV_BAR_HEIGHT = 56;

// Configure DOMPurify to allow mark tags and data attributes
const purifyConfig = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "b", "i", "u", "span", "mark",
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
    "table", "tr", "td", "th", "thead", "tbody", "div", "a", "sup", "sub",
  ],
  ALLOWED_ATTR: [
    "class", "style", "data-field", "data-override", "data-sugerencia-idx", "data-group",
    "href", "target",
  ],
};

const sanitize = (html: string) => DOMPurify.sanitize(html, purifyConfig);

/**
 * Normaliza placeholders fragmentados por mammoth.
 * Word divide internamente los "runs" XML, así que `{comparecientes_vendedor}`
 * puede convertirse en `<span>{comparecientes_</span><span>vendedor}</span>`.
 * 
 * Enfoque robusto: extrae texto plano, encuentra placeholders `{...}` en el texto,
 * y reemplaza las secciones correspondientes del HTML original.
 */
function normalizeTemplateTags(html: string): string {
  // Step 1: Try the simple regex first for non-fragmented cases
  let result = html.replace(/\{(?:[^}<]*(?:<[^>]*>[^}<]*)*)\}/g, (match) => {
    const text = match.replace(/<[^>]*>/g, "").replace(/\s+/g, "");
    return text;
  });

  // Step 2: Handle cases where { and } are in completely different elements
  // Build a text-to-html position map
  const textOnly = result.replace(/<[^>]*>/g, "");
  const placeholderRegex = /\{([a-zA-Z_#/^][a-zA-Z0-9_.#/^]*)\}/g;
  let match: RegExpExecArray | null;
  const foundInText: string[] = [];
  while ((match = placeholderRegex.exec(textOnly)) !== null) {
    foundInText.push(match[0]);
  }

  // For each placeholder found in plain text, ensure it exists as a continuous string in the HTML
  for (const placeholder of foundInText) {
    if (result.includes(placeholder)) continue; // Already continuous, skip

    // Build a regex that matches the placeholder chars with optional HTML tags between them
    const chars = placeholder.split("");
    const flexPattern = chars.map(c => {
      const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return escaped;
    }).join("(?:<[^>]*>)*\\s*");
    
    try {
      const flexRegex = new RegExp(flexPattern, "g");
      result = result.replace(flexRegex, placeholder);
    } catch {
      // If regex fails, skip this placeholder
    }
  }

  return result;
}

/**
 * Process loop sections like {#vendedores}...{/vendedores} and conditionals like {#afectacion_vivienda}...{/afectacion_vivienda}
 */
function processLoops(
  html: string,
  vendedores: Persona[],
  compradores: Persona[],
  inmueble: Inmueble,
  actos: Actos
): string {
  let result = html;

  // Helper: expand a person loop
  const expandPersonLoop = (tag: string, personas: Persona[], src: string): string => {
    const openTag = `{#${tag}}`;
    const closeTag = `{/${tag}}`;
    let output = src;
    let safety = 0;

    while (output.includes(openTag) && safety < 10) {
      safety++;
      const startIdx = output.indexOf(openTag);
      const endIdx = output.indexOf(closeTag, startIdx);
      if (endIdx === -1) break;

      const before = output.substring(0, startIdx);
      const inner = output.substring(startIdx + openTag.length, endIdx);
      const after = output.substring(endIdx + closeTag.length);

      const expanded = personas.map((p) => {
        let block = inner;
        const pAny = p as any;
        const personaFields: Record<string, string> = {
          nombre: p.nombre_completo || "___________",
          nombre_completo: p.nombre_completo || "___________",
          cedula: p.numero_cedula ? formatCedulaLegal(p.numero_cedula, p.lugar_expedicion || p.municipio_domicilio) : "___________",
          numero_cedula: p.numero_cedula || "___________",
          numero_identificacion: p.numero_cedula || "___________",
          expedida_en: p.lugar_expedicion || p.municipio_domicilio || "___________",
          lugar_expedicion: p.lugar_expedicion || p.municipio_domicilio || "___________",
          estado_civil: p.estado_civil || "___________",
          domicilio: p.municipio_domicilio || "___________",
          municipio_domicilio: p.municipio_domicilio || "___________",
          direccion: p.direccion || "___________",
          direccion_residencia: p.direccion || "___________",
          razon_social: p.razon_social || "___________",
          nit: p.nit || "___________",
          representante_legal_nombre: p.representante_legal_nombre || "___________",
          representante_legal_cedula: p.representante_legal_cedula || "___________",
          telefono: pAny.telefono || "___________",
          actividad_economica: pAny.actividad_economica || "___________",
          email: pAny.email || "___________",
        };
        // Process per-person conditionals: {#es_pep}...{/es_pep}, {^es_pep}...{/es_pep}
        const personConds: Record<string, boolean> = {
          es_pep: !!p.es_pep,
          acepta_notificaciones: !!(pAny.acepta_notificaciones),
        };
        for (const [ck, cv] of Object.entries(personConds)) {
          const po = `{#${ck}}`, pc = `{/${ck}}`, no = `{^${ck}}`;
          let ss = 0;
          while (block.includes(po) && ss < 5) { ss++; const si2=block.indexOf(po); const ei2=block.indexOf(pc,si2); if(ei2===-1)break; block=block.substring(0,si2)+(cv?block.substring(si2+po.length,ei2):"")+block.substring(ei2+pc.length); }
          ss = 0;
          while (block.includes(no) && ss < 5) { ss++; const si2=block.indexOf(no); const ei2=block.indexOf(pc,si2); if(ei2===-1)break; block=block.substring(0,si2)+(!cv?block.substring(si2+no.length,ei2):"")+block.substring(ei2+pc.length); }
        }
        for (const [key, value] of Object.entries(personaFields)) {
          block = block.replace(new RegExp(`\\{${key}\\}`, "g"), value);
        }
        return block;
      }).join("");

      output = before + expanded + after;
    }
    return output;
  };

  result = expandPersonLoop("vendedores", vendedores, result);
  result = expandPersonLoop("compradores", compradores, result);

  // NOTE: Bare ___________ from persona loops will be unified AFTER buildReplacements
  // to avoid being swallowed inside resolved spans.

  // Process boolean conditionals: {#key}...{/key} (show if truthy) and {^key}...{/key} (show if falsy)
  const conditionals: Record<string, boolean> = {
    afectacion_vivienda: !!(actos as any).afectacion_vivienda_familiar,
    "actos.afectacion_vivienda": !!(actos as any).afectacion_vivienda_familiar,
    es_hipoteca: actos.es_hipoteca,
    tiene_hipoteca: actos.es_hipoteca,
    "inmueble.es_rph": inmueble.es_propiedad_horizontal,
  };

  for (const [key, value] of Object.entries(conditionals)) {
    // Positive conditional {#key}...{/key}
    const posOpen = `{#${key}}`;
    const posClose = `{/${key}}`;
    let s = 0;
    while (result.includes(posOpen) && s < 10) {
      s++;
      const si = result.indexOf(posOpen);
      const ei = result.indexOf(posClose, si);
      if (ei === -1) break;
      const before = result.substring(0, si);
      const inner = result.substring(si + posOpen.length, ei);
      const after = result.substring(ei + posClose.length);
      result = before + (value ? inner : "") + after;
    }

    // Negative conditional {^key}...{/key}
    const negOpen = `{^${key}}`;
    s = 0;
    while (result.includes(negOpen) && s < 10) {
      s++;
      const si = result.indexOf(negOpen);
      const ei = result.indexOf(posClose, si);
      if (ei === -1) break;
      const before = result.substring(0, si);
      const inner = result.substring(si + negOpen.length, ei);
      const after = result.substring(ei + posClose.length);
      result = before + (!value ? inner : "") + after;
    }
  }

  return result;
}

/**
 * Returns an OCR-derived suggestion for a given template field, or undefined.
 * Pure function — only returns when source data exists and is non-empty.
 */
function getSuggestionForField(
  field: string,
  extractedDocumento: any,
  extractedPredial: any,
  inmueble: Inmueble,
  actos: Actos,
): { value: string; source: string } | undefined {
  const pick = (v: any): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s && s !== "___________" ? s : undefined;
  };

  if (field === "inmueble.matricula" || field === "matricula_inmobiliaria") {
    const v = pick(extractedDocumento?.titulo_antecedente?.matricula_inmobiliaria);
    if (v) return { value: v, source: "Cert. Tradición" };
  }
  if (field === "inmueble.cedula_catastral" || field === "identificador_predial") {
    const v = pick(extractedPredial?.identificador_predial) || pick(extractedPredial?.cedula_catastral);
    if (v) return { value: v, source: "Predial" };
  }
  if (field === "inmueble.direccion" || field === "direccion_inmueble") {
    const vp = pick(extractedPredial?.direccion);
    if (vp) return { value: vp, source: "Predial" };
    const vd = pick(extractedDocumento?.titulo_antecedente?.direccion);
    if (vd) return { value: vd, source: "Cert. Tradición" };
  }
  if (field === "inmueble.estrato" || field === "estrato") {
    const v = pick(extractedPredial?.estrato);
    if (v) return { value: v, source: "Predial" };
  }
  if (field === "inmueble.avaluo_catastral" || field === "avaluo_catastral") {
    const v = pick(extractedPredial?.valor_pagado);
    if (v) return { value: v, source: "Predial" };
  }
  if (field === "actos.entidad_nit") {
    const bank = lookupBank(actos.entidad_bancaria || "");
    if (bank?.nit) return { value: bank.nit, source: "Directorio bancos" };
  }
  if (field === "actos.entidad_domicilio") {
    const bank = lookupBank(actos.entidad_bancaria || "");
    if (bank?.domicilio) return { value: bank.domicilio, source: "Directorio bancos" };
  }
  if (field === "notaria_previa_numero" || field === "antecedentes.notaria_previa_numero") {
    const v = pick(extractedDocumento?.titulo_antecedente?.notaria_documento) || pick(extractedDocumento?.notaria_origen);
    if (v) return { value: v, source: "Cert. Tradición" };
  }
  if (field === "antecedentes.escritura_num_numero" || field === "escritura_num_numero") {
    const v = pick(extractedDocumento?.titulo_antecedente?.numero_documento) || pick(extractedDocumento?.numero_escritura);
    if (v) return { value: v, source: "Cert. Tradición" };
  }
  if (field === "antecedentes.notaria_previa_circulo") {
    const v = pick(extractedDocumento?.titulo_antecedente?.ciudad_documento);
    if (v) return { value: v, source: "Cert. Tradición" };
  }

  return undefined;
}

const DocxPreview = ({
  vendedores,
  compradores,
  inmueble,
  actos,
  overrides = [],
  manualFieldOverrides = {},
  onFieldEdit,
  onCreateOverride,
  onRemoveOverride,
  sugerenciasIA = [],
  generating = false,
  textoFinalWord,
  onSugerenciaAccepted,
  notariaConfig,
  notariaTramite,
  extractedDocumento,
  extractedPredial,
  slotsPendientes = [],
  onScrollToField,
}: DocxPreviewProps) => {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseHtml, setBaseHtml] = useState<string>("");
  const [pageCount, setPageCount] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [scale, setScale] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Edit popover state
  const [editPopover, setEditPopover] = useState<{
    field: string;
    value: string;
    position: { top: number; left: number };
    suggestion?: { value: string; source: string };
  } | null>(null);

  // Selection toolbar state (inline edit)
  const [selectionToolbar, setSelectionToolbar] = useState<{
    text: string;
    position: { top: number; left: number };
    contextBefore: string;
    contextAfter: string;
    occurrenceCount: number;
  } | null>(null);

  // Sugerencia popover state
  const [sugerenciaPopover, setSugerenciaPopover] = useState<{
    idx: number;
    sugerencia: SugerenciaIA;
    position: { top: number; left: number };
  } | null>(null);

  // Scroll-to-occurrence state for audit navigation
  const [scrollToOccurrence, setScrollToOccurrence] = useState<{ text: string; index: number } | null>(null);

  // Observe container size for responsive scaling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const h = entry.contentRect.height - NAV_BAR_HEIGHT;
      setScale(Math.min(1, (w - 32) / PAGE_WIDTH, (h - 32) / PAGE_HEIGHT));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load template once
  useEffect(() => {
    const loadTemplate = async () => {
      try {
        setLoading(true);
        const response = await fetch("/template_venta_hipoteca.docx");
        if (!response.ok) {
          setError("No se pudo cargar la plantilla");
          return;
        }
        const buffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        const normalized = normalizeTemplateTags(result.value);
        
        const templatePlaceholders = normalized.match(/\{[a-zA-Z_#/^][a-zA-Z0-9_.#/^]*\}/g) || [];
        if (templatePlaceholders.length > 0) {
          console.debug("[DocxPreview] Template loaded with", templatePlaceholders.length, "placeholders");
        }
        setBaseHtml(normalized);
      } catch (err: any) {
        console.error("Template load error:", err);
        setError("Error al cargar plantilla: " + err.message);
      } finally {
        setLoading(false);
      }
    };
    loadTemplate();
  }, []);

  // Build replacement map
  const buildReplacements = useCallback((): Record<string, string> => {
    const formatPersona = (p: Persona) => {
      if (p.es_persona_juridica) {
        return `${p.razon_social || "___________"}, NIT ${p.nit || "___________"}, representada legalmente por ${p.representante_legal_nombre || "___________"}, identificado(a) con cédula de ciudadanía No. ${p.representante_legal_cedula || "___________"}`;
      }
      return `${p.nombre_completo || "___________"}, mayor de edad, identificado(a) con cédula de ciudadanía No. ${p.numero_cedula || "___________"}, de estado civil ${p.estado_civil || "___________"}, domiciliado(a) en ${p.municipio_domicilio || "___________"}`;
    };

    // Derived values
    const areaValue = inmueble.area || inmueble.area_construida || inmueble.area_privada || "";
    const valorCompraventa = actos.valor_compraventa || "";
    const valorCompraventaLetras = valorCompraventa ? formatMonedaLegal(valorCompraventa) : "";
    const valorHipoteca = actos.valor_hipoteca || "";
    const valorHipotecaLetras = valorHipoteca ? formatMonedaLegal(valorHipoteca) : "";

    // Parse RPH from escritura_ph / reformas_ph
    const rphData = parseEscrituraString(inmueble.escritura_ph);
    const rphReformas = parseEscrituraString(inmueble.reformas_ph);

    // Parse fecha_poder for apoderado banco date components
    const poderFechaParsed = parseEscrituraString((actos as any).apoderado_fecha_poder ? `DEL ${(actos as any).apoderado_fecha_poder}` : undefined);

    // Parse fecha_credito for credit date components
    const fechaCreditoStr = (actos as any).fecha_credito || "";
    const fechaCreditoParsed = (() => {
      if (!fechaCreditoStr) return { dia: undefined, mes: undefined, anio: undefined };
      const parts = fechaCreditoStr.split("-"); // YYYY-MM-DD from input[type=date]
      if (parts.length === 3) {
        const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
        return { dia: parseInt(parts[2], 10).toString(), mes: meses[parseInt(parts[1], 10) - 1], anio: parts[0] };
      }
      return { dia: undefined, mes: undefined, anio: undefined };
    })();

    const replacements: Record<string, string> = {
      // Legacy flat persona fields
      "comparecientes_vendedor": vendedores.map(formatPersona).join("; y ") || "___________",
      "comparecientes_comprador": compradores.map(formatPersona).join("; y ") || "___________",
      // Inmueble core
      "matricula_inmobiliaria": inmueble.matricula_inmobiliaria || "___________",
      "inmueble.matricula": inmueble.matricula_inmobiliaria || "___________",
      "identificador_predial": inmueble.identificador_predial || "___________",
      "inmueble.cedula_catastral": inmueble.identificador_predial || "___________",
      "direccion_inmueble": inmueble.direccion || "___________",
      "inmueble.direccion": inmueble.direccion || "___________",
      "inmueble.linderos_especiales": inmueble.linderos || "___________",
      "inmueble.linderos_generales": inmueble.linderos || "___________",
      "municipio": inmueble.municipio || "___________",
      "inmueble.municipio": inmueble.municipio || "___________",
      "departamento": inmueble.departamento || "___________",
      "inmueble.departamento": inmueble.departamento || "___________",
      "area": areaValue || "___________",
      "inmueble.area": areaValue || "___________",
      "linderos": inmueble.linderos || "___________",
      "avaluo_catastral": inmueble.avaluo_catastral ? formatMonedaLegal(inmueble.avaluo_catastral) : "___________",
      "inmueble.avaluo_catastral": inmueble.avaluo_catastral ? formatMonedaLegal(inmueble.avaluo_catastral) : "___________",
      "codigo_orip": inmueble.codigo_orip || "___________",
      "inmueble.orip_ciudad": inmueble.codigo_orip || "___________",
      "inmueble.orip_zona": inmueble.codigo_orip || "___________",
      // Inmueble extended
      "nupre": inmueble.nupre || "___________",
      "inmueble.nupre": inmueble.nupre || "___________",
      "tipo_predio": inmueble.tipo_predio || "___________",
      "inmueble.tipo_predio": inmueble.tipo_predio || "___________",
      "area_construida": inmueble.area_construida || "___________",
      "inmueble.area_construida": inmueble.area_construida || "___________",
      "area_privada": inmueble.area_privada || "___________",
      "inmueble.area_privada": inmueble.area_privada || "___________",
      "escritura_ph": inmueble.escritura_ph || "___________",
      "inmueble.escritura_ph": inmueble.escritura_ph || "___________",
      "reformas_ph": inmueble.reformas_ph || "___________",
      "inmueble.reformas_ph": inmueble.reformas_ph || "___________",
      "estrato": inmueble.estrato || "___________",
      "inmueble.estrato": inmueble.estrato || "___________",
      // Actos — with number→words conversion
      "tipo_acto": actos.tipo_acto || "___________",
      "valor_compraventa_letras": valorCompraventaLetras || actos.valor_compraventa || "___________",
      "actos.cuantia_compraventa_letras": valorCompraventaLetras || actos.valor_compraventa || "___________",
      "actos.cuantia_compraventa_numero": actos.valor_compraventa || "___________",
      "actos.cuantia_hipoteca_letras": valorHipotecaLetras || actos.valor_hipoteca || "___________",
      "actos.cuantia_hipoteca_numero": actos.valor_hipoteca || "___________",
      "entidad_bancaria": actos.entidad_bancaria || "___________",
      "actos.entidad_bancaria": actos.entidad_bancaria || "___________",
      "actos.entidad_domicilio": (() => {
        const val = (actos as any).entidad_domicilio;
        if (val) return val;
        const bank = lookupBank(actos.entidad_bancaria || "");
        return bank?.domicilio || "___________";
      })(),
      "actos.entidad_nit": (() => {
        const val = (actos as any).entidad_nit;
        if (val) return val;
        const bank = lookupBank(actos.entidad_bancaria || "");
        return bank?.nit || "___________";
      })(),
      "valor_hipoteca_letras": valorHipotecaLetras || actos.valor_hipoteca || "___________",
      "actos.valor_hipoteca_letras": valorHipotecaLetras || actos.valor_hipoteca || "___________",
      "actos.valor_hipoteca_numero": actos.valor_hipoteca || "___________",
      "actos.fecha_escritura_letras": "___________",
      // Pago inicial / saldo financiado
      "actos.pago_inicial_letras": (actos as any).pago_inicial ? numberToWords((actos as any).pago_inicial) : "___________",
      "actos.pago_inicial_numero": (actos as any).pago_inicial || "___________",
      "actos.saldo_financiado_letras": (actos as any).saldo_financiado ? numberToWords((actos as any).saldo_financiado) : "___________",
      "actos.saldo_financiado_numero": (actos as any).saldo_financiado || "___________",
      // Fecha crédito parsed
      "actos.credito_dia_letras": fechaCreditoParsed.dia || "___________",
      "actos.credito_dia_num": fechaCreditoParsed.dia || "___________",
      "actos.credito_mes": fechaCreditoParsed.mes || "___________",
      "actos.credito_anio_letras": fechaCreditoParsed.anio || "___________",
      "actos.credito_anio_num": fechaCreditoParsed.anio || "___________",
      "actos.redam_resultado": "___________",
      // Inmueble extended — predial from metadata
      "inmueble.predial_anio": extractedPredial?.anio_gravable || "___________",
      "inmueble.predial_num": extractedPredial?.numero_recibo || "___________",
      "inmueble.predial_valor": extractedPredial?.valor_pagado ? formatMonedaLegal(extractedPredial.valor_pagado) : "___________",
      "inmueble.idu_num": "___________",
      "inmueble.idu_fecha": "___________",
      "inmueble.idu_vigencia": "___________",
      "inmueble.admin_fecha": "___________",
      "inmueble.admin_vigencia": "___________",
      // RPH (propiedad horizontal) — prefer structured OCR fields, fallback to parsed string
      "rph.escritura": inmueble.escritura_ph || "___________",
      "rph.escritura_num_letras": (inmueble as any).escritura_ph_numero ? `(${(inmueble as any).escritura_ph_numero})` : rphData.numero ? `(${rphData.numero})` : "___________",
      "rph.escritura_num_numero": (inmueble as any).escritura_ph_numero || rphData.numero || "___________",
      "rph.escritura_dia_letras": (() => { const f = (inmueble as any).escritura_ph_fecha; if (f) { const p = parseFechaDoc(f); return p.dia || "___________"; } return rphData.dia || "___________"; })(),
      "rph.escritura_dia_num": (() => { const f = (inmueble as any).escritura_ph_fecha; if (f) { const p = parseFechaDoc(f); return p.dia || "___________"; } return rphData.dia || "___________"; })(),
      "rph.escritura_mes": (() => { const f = (inmueble as any).escritura_ph_fecha; if (f) { const p = parseFechaDoc(f); return p.mes || "___________"; } return rphData.mes || "___________"; })(),
      "rph.escritura_anio_letras": (() => { const f = (inmueble as any).escritura_ph_fecha; if (f) { const p = parseFechaDoc(f); return p.anio || "___________"; } return rphData.anio || "___________"; })(),
      "rph.escritura_anio_num": (() => { const f = (inmueble as any).escritura_ph_fecha; if (f) { const p = parseFechaDoc(f); return p.anio || "___________"; } return rphData.anio || "___________"; })(),
      "rph.notaria": (inmueble as any).escritura_ph_notaria || rphData.notaria || notariaConfig?.nombre_notaria || "___________",
      "rph.notaria_numero": notariaConfig?.numero_notaria?.toString() || "___________",
      "rph.notaria_ciudad": (inmueble as any).escritura_ph_ciudad || notariaConfig?.ciudad || "___________",
      "rph.matricula_matriz": inmueble.matricula_matriz || "___________",
      "inmueble.nombre_edificio_conjunto": (inmueble as any).nombre_edificio_conjunto || "___________",
      "inmueble.coeficiente_letras": (inmueble as any).coeficiente_copropiedad || "___________",
      "inmueble.coeficiente_numero": (inmueble as any).coeficiente_copropiedad || "___________",
      // Antecedentes — prefer titulo_antecedente (OCR from certificado), fallback to extractedDocumento
      "antecedentes.titulo_tipo": extractedDocumento?.titulo_antecedente?.tipo_documento || "Escritura Pública",
      "antecedentes.modo": extractedDocumento?.titulo_antecedente?.tipo_documento || extractedDocumento?.modo_adquisicion || "___________",
      "antecedentes.modo_adquisicion": extractedDocumento?.titulo_antecedente?.tipo_documento || extractedDocumento?.modo_adquisicion || "___________",
      "antecedentes.adquirido_de": extractedDocumento?.titulo_antecedente?.adquirido_de || extractedDocumento?.adquirido_de || "___________",
      "antecedentes.escritura": extractedDocumento?.titulo_antecedente?.numero_documento || extractedDocumento?.numero_escritura || "___________",
      "antecedentes.escritura_num_letras": (() => { const n = extractedDocumento?.titulo_antecedente?.numero_documento || extractedDocumento?.numero_escritura; return n ? `(${n})` : "___________"; })(),
      "antecedentes.escritura_num_numero": extractedDocumento?.titulo_antecedente?.numero_documento || extractedDocumento?.numero_escritura || "___________",
      "antecedentes.escritura_dia_letras": (() => { const f = extractedDocumento?.titulo_antecedente?.fecha_documento || extractedDocumento?.fecha_documento; if (!f) return "___________"; const p = parseFechaDoc(f); return p.dia || "___________"; })(),
      "antecedentes.escritura_dia_num": (() => { const f = extractedDocumento?.titulo_antecedente?.fecha_documento || extractedDocumento?.fecha_documento; if (!f) return "___________"; const p = parseFechaDoc(f); return p.dia || "___________"; })(),
      "antecedentes.escritura_mes": (() => { const f = extractedDocumento?.titulo_antecedente?.fecha_documento || extractedDocumento?.fecha_documento; if (!f) return "___________"; const p = parseFechaDoc(f); return p.mes || "___________"; })(),
      "antecedentes.escritura_anio_letras": (() => { const f = extractedDocumento?.titulo_antecedente?.fecha_documento || extractedDocumento?.fecha_documento; if (!f) return "___________"; const p = parseFechaDoc(f); return p.anio || "___________"; })(),
      "antecedentes.escritura_anio_num": (() => { const f = extractedDocumento?.titulo_antecedente?.fecha_documento || extractedDocumento?.fecha_documento; if (!f) return "___________"; const p = parseFechaDoc(f); return p.anio || "___________"; })(),
      "antecedentes.fecha_legal": (() => { const f = extractedDocumento?.titulo_antecedente?.fecha_documento || extractedDocumento?.fecha_documento; return f ? formatFechaLegal(f) : "___________"; })(),
      "antecedentes.notaria": extractedDocumento?.titulo_antecedente?.notaria_documento || extractedDocumento?.notaria_origen || "___________",
      "antecedentes.notaria_previa_numero": extractedDocumento?.titulo_antecedente?.notaria_documento || extractedDocumento?.notaria_origen || "___________",
      "antecedentes.notaria_previa_circulo": extractedDocumento?.titulo_antecedente?.ciudad_documento || "___________",
      "antecedentes.fecha": (() => { const f = extractedDocumento?.titulo_antecedente?.fecha_documento || extractedDocumento?.fecha_documento; return f ? formatFechaLegal(f) : "___________"; })(),
      // Apoderado banco — from expanded actos
      "apoderado_banco.nombre": actos.apoderado_nombre || "___________",
      "apoderado_banco.cedula": actos.apoderado_cedula || "___________",
      "apoderado_banco.expedida_en": (actos as any).apoderado_expedida_en || "___________",
      "apoderado_banco.escritura_poder_num": (actos as any).apoderado_escritura_poder || "___________",
      "apoderado_banco.poder_dia_letras": poderFechaParsed.dia || "___________",
      "apoderado_banco.poder_dia_num": poderFechaParsed.dia || "___________",
      "apoderado_banco.poder_mes": poderFechaParsed.mes || "___________",
      "apoderado_banco.poder_anio_letras": poderFechaParsed.anio || "___________",
      "apoderado_banco.poder_anio_num": poderFechaParsed.anio || "___________",
      "apoderado_banco.notaria_poder_num": (actos as any).apoderado_notaria_poder || "___________",
      "apoderado_banco.notaria_poder_ciudad": (actos as any).apoderado_notaria_ciudad || "___________",
      "apoderado_banco.email": (actos as any).apoderado_email || "___________",
      // Notario / Notaría — SIEMPRE desde notariaTramite (este trámite). Sin pre-llenado desde org/notariaConfig.
      // Los placeholders nuevos del template (notaria_numero_letras, notaria_ordinal, notaria_circulo, etc.)
      // caen a "___________" si el usuario no los ha llenado o no aceptó la sugerencia de Claude.
      "notario_nombre": notariaTramite?.nombre_notario || "___________",
      "notario_decreto": notariaTramite?.decreto_nombramiento || "___________",
      "notario_tipo": notariaTramite?.tipo_notario || "",  // vacío si TITULAR (queda limpio en docx)
      "notaria_nombre": "___________",
      "notaria_ciudad": notariaTramite?.circulo || "___________",
      "notaria_circulo": notariaTramite?.circulo || "___________",
      "notaria_circulo_proper": notariaTramite?.circulo ? toProperCase(notariaTramite.circulo) : "___________",
      "notaria_departamento": notariaTramite?.departamento || "___________",
      "notaria_numero": notariaTramite?.numero_notaria || "___________",
      "notaria_numero_letras": (() => {
        if (notariaTramite?.numero_notaria_letras) return notariaTramite.numero_notaria_letras;
        const auto = numeroNotariaToLetras(notariaTramite?.numero_notaria || "");
        return auto || "___________";
      })(),
      "notaria_numero_letras_lower": (() => {
        const v = notariaTramite?.numero_notaria_letras || numeroNotariaToLetras(notariaTramite?.numero_notaria || "");
        return v ? v.toLowerCase() : "___________";
      })(),
      "notaria_numero_letras_femenino": (() => {
        const v = notariaTramite?.numero_notaria_letras || numeroNotariaToLetras(notariaTramite?.numero_notaria || "");
        return v ? deriveFemenino(v) : "___________";
      })(),
      "notaria_ordinal": (() => {
        if (notariaTramite?.numero_ordinal) return notariaTramite.numero_ordinal;
        const auto = numeroToOrdinalAbbr(notariaTramite?.numero_notaria || "", "volada");
        return auto || "___________";
      })(),
      "escritura_numero": "___________",
      "fecha_escritura_corta": "___________",
    };

    // Manual edits from popover (unmapped fields) take highest precedence —
    // they always win over computed defaults / "___________" placeholders.
    return { ...replacements, ...manualFieldOverrides };
  }, [vendedores, compradores, inmueble, actos, notariaConfig, notariaTramite, extractedDocumento, extractedPredial, manualFieldOverrides]);

  // Apply replacements or use textoFinalWord
  useEffect(() => {
    // If we have AI-generated text, use it instead of template
    if (textoFinalWord) {
      let result = textoFinalWord;

      // ── Pase A: limpieza tipográfica defensiva (paréntesis vacíos / dobles) ──
      result = result
        .replace(/\)\s*\)+/g, ")")                 // "))" → ")"
        .replace(/\(\s*\(+/g, "(")                 // "((" → "("
        .replace(/(_{6,})\s*\(\s*_{6,}\s*\)/g, "$1") // "_____ (_____)" → "_____"
        .replace(/\(\s*\)/g, "")                    // "( )" → ""
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.;:])/g, "$1");

      // ── Pase B: inferir data-field semántico para blanks de notario ──
      // Reusa la misma clase var-pending y estilo rojo del template branch.
      const pendingRedStyle = "background:hsl(0 84% 95%);color:hsl(0 72% 51%);text-decoration:underline;cursor:pointer";
      const makePendingSpan = (field: string) =>
        `<span data-field="${field}" class="var-pending" style="${pendingRedStyle}" title="Haz clic para editar">___________</span>`;

      // NOTARIO/NOTARÍA ___________ → notaria_numero_letras
      result = result.replace(
        /(NOTAR[IÍ]O|NOTAR[IÍ]A)(\s+)(_{6,})/gi,
        (_m, word, sp) => `${word}${sp}${makePendingSpan("notaria_numero_letras")}`,
      );
      // CÍRCULO DE ___________ → notaria_circulo
      result = result.replace(
        /(C[IÍ]RCULO\s+DE\s+)(_{6,})/gi,
        (_m, prefix) => `${prefix}${makePendingSpan("notaria_circulo")}`,
      );
      // DEPARTAMENTO DE ___________ → notaria_departamento
      result = result.replace(
        /(DEPARTAMENTO\s+DE\s+)(_{6,})/gi,
        (_m, prefix) => `${prefix}${makePendingSpan("notaria_departamento")}`,
      );

      // ── Pase C: envolver blanks restantes como genéricos clickeables ──
      const genericPendingSpan = `<span data-field="__ai_blank__" class="var-pending" style="${pendingRedStyle}" title="Haz clic para editar">___________</span>`;
      const segments = result.split(/_{6,}/);
      if (segments.length > 1) {
        result = segments.map((segment, i, arr) => {
          if (i === arr.length - 1) return segment;
          // No envolver si está dentro de un atributo HTML abierto
          const lastAttrOpen = Math.max(segment.lastIndexOf('="'), segment.lastIndexOf("='"));
          const lastTagClose = segment.lastIndexOf(">");
          if (lastAttrOpen > lastTagClose) return segment + "___________";
          // No envolver si estamos dentro de una etiqueta <span ...> aún sin cerrar
          const lastLt = segment.lastIndexOf("<");
          const lastGt = segment.lastIndexOf(">");
          if (lastLt > lastGt) return segment + "___________";
          return segment + genericPendingSpan;
        }).join("");
      }

      // Apply sugerencias_ia highlights
      if (sugerenciasIA.length > 0) {
        result = applySugerenciaHighlights(result, sugerenciasIA);
      }

      setHtml(sanitize(result));
      return;
    }

    if (!baseHtml) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Fields that belong to optional pending slots
      const pendingSlotFields: Record<string, string[]> = {
        carta_credito: ["valor_hipoteca", "valor_hipoteca_letras", "entidad_bancaria", "entidad_nit", "entidad_domicilio", "fecha_credito", "pago_inicial", "saldo_financiado", "actos.entidad_bancaria", "actos.cuantia_hipoteca"],
        poder_notarial: ["apoderado_nombre", "apoderado_cedula", "apoderado_expedida_en", "apoderado_escritura_poder", "apoderado_fecha_poder", "apoderado_notaria_poder", "apoderado_notaria_ciudad", "apoderado_email"],
      };
      const optionalPendingFields = new Set<string>();
      for (const slot of slotsPendientes) {
        for (const field of (pendingSlotFields[slot] || [])) {
          optionalPendingFields.add(field);
        }
      }

      const pendingRedStyle = 'background:hsl(0 84% 95%);color:hsl(0 72% 51%);text-decoration:underline;cursor:pointer';
      const pendingOrangeStyle = 'background:hsl(38 92% 95%);color:hsl(38 80% 40%);text-decoration:underline;cursor:pointer';

      // Step 1: Process loops (vendedores, compradores, conditionals)
      let result = processLoops(baseHtml, vendedores, compradores, inmueble, actos);
      
      // Step 2: Apply flat replacements
      const replacements = buildReplacements();

      for (const [key, value] of Object.entries(replacements)) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const isUserEdited = key in manualFieldOverrides && !!manualFieldOverrides[key];
        if (value && value !== "___________") {
          const cls = isUserEdited ? "var-user-edited" : "var-resolved";
          const style = isUserEdited
            ? "color:#6d28d9;background:#f5f3ff;font-weight:bold;cursor:pointer;border-bottom:1px dashed #6d28d9;border-radius:2px;padding:0 2px"
            : "color:#065f46;font-weight:bold;cursor:pointer;border-bottom:1px dashed #065f46";
          result = result.replace(
            new RegExp(`\\{${escaped}\\}`, "g"),
            `<span data-field="${key}" class="${cls}" style="${style}">${value}</span>`
          );
        } else {
          const style = optionalPendingFields.has(key) ? pendingOrangeStyle : pendingRedStyle;
          const title = optionalPendingFields.has(key) ? "Pendiente — documento opcional no cargado" : "Haz clic para ir al campo";
          result = result.replace(
            new RegExp(`\\{${escaped}\\}`, "g"),
            `<span data-field="${key}" class="var-pending" style="${style}" title="${title}">___________</span>`
          );
        }
      }

      // ── Bloque único Notaría: agrupar visualmente {letras} + {ordinal} en orden canónico ──
      // Estándar Colombia: "QUINTA (5.ª)" — siempre LETRAS (NÚMERO ENTRE PARÉNTESIS).
      // Detecta los dos spans adyacentes en cualquier orden (con paréntesis u otros separadores)
      // y los reemite envueltos en un único contenedor morado.
      {
        const spanRe = /<span data-field="notaria_(numero_letras|ordinal)"[^>]*>([^<]*)<\/span>/g;
        type Hit = { full: string; key: "letras" | "ordinal"; text: string; start: number; end: number };
        const hits: Hit[] = [];
        let m: RegExpExecArray | null;
        while ((m = spanRe.exec(result)) !== null) {
          hits.push({
            full: m[0],
            key: m[1] === "numero_letras" ? "letras" : "ordinal",
            text: m[2],
            start: m.index,
            end: m.index + m[0].length,
          });
        }
        // Buscar pares adyacentes (separados solo por whitespace/paréntesis)
        for (let i = hits.length - 2; i >= 0; i--) {
          const a = hits[i];
          const b = hits[i + 1];
          if (a.key === b.key) continue;
          const between = result.slice(a.end, b.start);
          if (!/^[\s\(\)]*$/.test(between)) continue;
          const letras = a.key === "letras" ? a : b;
          const ordinal = a.key === "ordinal" ? a : b;
          const isUserEditedL = "notaria_numero_letras" in manualFieldOverrides && !!manualFieldOverrides["notaria_numero_letras"];
          const isUserEditedO = "notaria_ordinal" in manualFieldOverrides && !!manualFieldOverrides["notaria_ordinal"];
          // Spans hijos: limpios (sin border ni background propio), conservan data-field para edición
          const childStyle = "color:#065f46;font-weight:bold;cursor:pointer";
          const childUserStyle = "color:#6d28d9;font-weight:bold;cursor:pointer";
          const lInner = `<span data-field="notaria_numero_letras" class="${isUserEditedL ? "var-user-edited" : "var-resolved"}" style="${isUserEditedL ? childUserStyle : childStyle}">${letras.text}</span>`;
          const oInner = `<span data-field="notaria_ordinal" class="${isUserEditedO ? "var-user-edited" : "var-resolved"}" style="${isUserEditedO ? childUserStyle : childStyle}">${ordinal.text}</span>`;
          // Wrapper: una sola caja morada (estilo agrupado)
          const groupStyle = "background:#f5f3ff;border-bottom:1px dashed #6d28d9;border-radius:2px;padding:0 4px;display:inline";
          const wrapper = `<span data-group="notaria-numero" style="${groupStyle}">${lInner} (${oInner})</span>`;
          result = result.slice(0, a.start) + wrapper + result.slice(b.end);
        }
      }

      // Clean remaining loop markers and unmapped placeholders
      result = result.replace(/\{[#/^][^}]*\}/g, "");
      result = result.replace(/\{[a-zA-Z_][a-zA-Z0-9_.]*\}/g, `<span class="var-pending" style="${pendingRedStyle}">___________</span>`);

      // Apply text overrides (replaces legacy custom variables)
      for (const ov of overrides) {
        if (ov.originalText && ov.newText) {
          const escapedText = ov.originalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const overrideSpan = `<span data-override="${ov.id}" style="color:#4c1d95;font-weight:bold;cursor:pointer;border-bottom:2px dashed #7c3aed">${ov.newText}</span>`;
          if (ov.replaceAll) {
            result = result.replace(new RegExp(escapedText, "g"), overrideSpan);
          } else {
            // Context-aware single replacement
            if (ov.contextBefore || ov.contextAfter) {
              const ctxBefore = ov.contextBefore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
              const ctxAfter = ov.contextAfter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
              const ctxRegex = new RegExp(`(${ctxBefore})(${escapedText})(${ctxAfter})`);
              const ctxMatch = result.match(ctxRegex);
              if (ctxMatch) {
                result = result.replace(ctxRegex, `$1${overrideSpan}$3`);
              } else {
                // Fallback: first occurrence
                result = result.replace(new RegExp(escapedText), overrideSpan);
              }
            } else {
              result = result.replace(new RegExp(escapedText), overrideSpan);
            }
          }
        }
      }

      // FINAL PASS: Unify ALL remaining bare ___________ with consistent styling
      // Step 1: Fix ___________ inside ANY span (resolved, pending, or other)
      result = result.replace(
        /<span([^>]*)>([^<]*___________[^<]*)<\/span>/g,
        (match, attrs, content) => {
          // If this is already a var-pending span with only ___________, leave it
          if (attrs.includes("var-pending") && content.trim() === "___________") return match;
          const parts = content.split("___________");
          return parts.map((part: string, i: number) => {
            const kept = part ? `<span${attrs}>${part}</span>` : "";
            const pending = i < parts.length - 1
              ? '<span class="var-pending" style="background:hsl(0 84% 95%);color:hsl(0 72% 51%);text-decoration:underline;cursor:pointer">___________</span>'
              : "";
            return kept + pending;
          }).join("");
        }
      );
      // Step 2: Wrap ALL remaining bare ___________ that are NOT inside a tag attribute or an existing span
      const pendingSpan = '<span class="var-pending" style="background:hsl(0 84% 95%);color:hsl(0 72% 51%);text-decoration:underline;cursor:pointer">___________</span>';
      const segments = result.split("___________");
      if (segments.length > 1) {
        result = segments.map((segment, i, arr) => {
          if (i === arr.length - 1) return segment;
          // Check: is the ___________ inside an HTML attribute (e.g. style="..." or title="...")?
          const lastQuoteOpen = Math.max(segment.lastIndexOf('="'), segment.lastIndexOf("='"));
          const lastQuoteClose = Math.max(segment.lastIndexOf('"'), segment.lastIndexOf("'"));
          if (lastQuoteOpen >= 0 && lastQuoteOpen > lastQuoteClose) return segment + "___________";
          // Check: is it already wrapped in a var-pending span?
          const lastOpenSpan = segment.lastIndexOf("<span");
          const lastCloseSpan = segment.lastIndexOf("</span>");
          const isInsideSpan = lastOpenSpan > lastCloseSpan && !segment.slice(lastOpenSpan).includes(">");
          if (isInsideSpan) return segment + "___________";
          return segment + pendingSpan;
        }).join("");
      }

      setHtml(sanitize(result));
    }, 80);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [baseHtml, buildReplacements, overrides, textoFinalWord, sugerenciasIA, slotsPendientes]);

  // Measure content and compute pages using scrollWidth from CSS columns
  useEffect(() => {
    if (!html || !contentRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (contentRef.current) {
        const contentWidth = PAGE_WIDTH - PAGE_PADDING_X * 2;
        const totalWidth = contentRef.current.scrollWidth;
        const newPageCount = Math.max(1, Math.round(totalWidth / contentWidth));
        setPageCount(newPageCount);
        setCurrentPage((prev) => Math.min(prev, newPageCount - 1));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [html]);

  // Scroll to specific occurrence for audit navigation
  useEffect(() => {
    if (!scrollToOccurrence || !contentRef.current) return;
    const { text, index } = scrollToOccurrence;
    const container = contentRef.current;

    // Use TreeWalker to find nth occurrence across text nodes
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const lowerText = text.toLowerCase();
    let matchCount = 0;
    let targetNode: Text | null = null;
    let targetOffset = 0;

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const content = node.textContent || "";
      const lowerContent = content.toLowerCase();
      let searchFrom = 0;

      while (searchFrom < lowerContent.length) {
        const pos = lowerContent.indexOf(lowerText, searchFrom);
        if (pos === -1) break;
        if (matchCount === index) {
          targetNode = node;
          targetOffset = pos;
          break;
        }
        matchCount++;
        searchFrom = pos + 1;
      }
      if (targetNode) break;
    }

    if (!targetNode || !targetNode.parentElement) return;

    // Calculate which page this occurrence is on (horizontal columns)
    const parentEl = targetNode.parentElement;
    const rect = parentEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const contentWidth = PAGE_WIDTH - PAGE_PADDING_X * 2;
    const relativeLeft = rect.left - containerRect.left + (currentPage * contentWidth);
    const targetPage = Math.floor(relativeLeft / contentWidth);
    setCurrentPage(Math.max(0, Math.min(pageCount - 1, targetPage)));

    // Create temporary glow span
    setTimeout(() => {
      if (!targetNode) return;
      try {
        const range = document.createRange();
        range.setStart(targetNode, targetOffset);
        range.setEnd(targetNode, Math.min(targetOffset + text.length, (targetNode.textContent || "").length));

        const glowSpan = document.createElement("span");
        glowSpan.className = "audit-glow";
        range.surroundContents(glowSpan);

        glowSpan.scrollIntoView({ behavior: "smooth", block: "center" });

        setTimeout(() => {
          if (glowSpan.parentNode) {
            const parent = glowSpan.parentNode;
            while (glowSpan.firstChild) {
              parent.insertBefore(glowSpan.firstChild, glowSpan);
            }
            parent.removeChild(glowSpan);
          }
        }, 3000);
      } catch {
        // If surroundContents fails (cross-node), just scroll to the parent
        parentEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
  }, [scrollToOccurrence, pageCount]);


  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Check for sugerencia click
    const sugEl = target.closest('[data-sugerencia-idx]') as HTMLElement | null;
    const sugerenciaIdx = sugEl?.getAttribute("data-sugerencia-idx") ?? null;
    if (sugEl && sugerenciaIdx !== null && sugerenciasIA.length > 0) {
      const idx = parseInt(sugerenciaIdx, 10);
      const sug = sugerenciasIA[idx];
      if (sug) {
        const rect = sugEl.getBoundingClientRect();
        setEditPopover(null);
        setSelectionToolbar(null);
        setSugerenciaPopover({
          idx,
          sugerencia: sug,
          position: { top: rect.bottom + 4, left: Math.max(8, rect.left) },
        });
        return;
      }
    }

    // Check for template variable click
    const fieldEl = target.closest('[data-field]') as HTMLElement | null;
    const field = fieldEl?.getAttribute("data-field");
    if (fieldEl && field) {
      const text = fieldEl.textContent || "";
      if (onFieldEdit) {
        const rect = fieldEl.getBoundingClientRect();
        setSelectionToolbar(null);
        setSugerenciaPopover(null);
        const isEmpty = text === "___________";
        // Blanks IA genéricos no tienen mapeo OCR conocido — abrir sin sugerencia.
        const suggestion =
          field === "__ai_blank__"
            ? undefined
            : getSuggestionForField(
                field,
                extractedDocumento,
                extractedPredial,
                inmueble,
                actos,
              );
        const finalSuggestion =
          suggestion && (isEmpty || suggestion.value !== text) ? suggestion : undefined;
        setEditPopover({
          field,
          value: isEmpty ? "" : text,
          position: { top: rect.bottom + 4, left: Math.max(8, rect.left) },
          suggestion: finalSuggestion,
        });
      }
      return;
    }

    // Check for override click
    const overrideEl = target.closest('[data-override]') as HTMLElement | null;
    const overrideId = overrideEl?.getAttribute("data-override");
    if (overrideEl && overrideId && onFieldEdit) {
      const ov = overrides.find((o) => o.id === overrideId);
      if (ov) {
        const rect = overrideEl.getBoundingClientRect();
        setSelectionToolbar(null);
        setSugerenciaPopover(null);
        setEditPopover({
          field: `__override__${ov.id}`,
          value: ov.newText,
          position: { top: rect.bottom + 4, left: Math.max(8, rect.left) },
        });
      }
    }
  }, [onFieldEdit, onScrollToField, overrides, sugerenciasIA, extractedDocumento, extractedPredial, inmueble, actos]);

  // Handle text selection for inline editing
  const handleMouseUp = useCallback(() => {
    if (!onCreateOverride) return;

    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

      const anchorNode = selection.anchorNode;
      if (!contentRef.current || !anchorNode || !contentRef.current.contains(anchorNode)) return;

      const anchorEl = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : (anchorNode as HTMLElement);
      if (anchorEl?.hasAttribute("data-field") || anchorEl?.hasAttribute("data-override") || anchorEl?.hasAttribute("data-sugerencia-idx")) return;

      const text = selection.toString().trim();
      if (text.length < 2 || text.length > 300) return;
      // Block purely decorative selections (only underscores, dots, dashes, spaces)
      if (!/[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ]/.test(text)) return;

      // Reject if selection contains template variables
      if (/\{[^}]+\}/.test(text)) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Extract context (40 chars before/after)
      const container = contentRef.current;
      const fullText = container.textContent || "";
      const selStart = fullText.indexOf(text);
      const ctxBefore = selStart > 0 ? fullText.slice(Math.max(0, selStart - 40), selStart) : "";
      const ctxAfter = fullText.slice(selStart + text.length, selStart + text.length + 40);

      // Count occurrences
      const escapedForCount = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const occurrences = (fullText.match(new RegExp(escapedForCount, "g")) || []).length;

      setEditPopover(null);
      setSugerenciaPopover(null);
      setSelectionToolbar({
        text,
        position: { top: rect.bottom + 4, left: Math.max(8, rect.left) },
        contextBefore: ctxBefore,
        contextAfter: ctxAfter,
        occurrenceCount: occurrences,
      });
    }, 10);
  }, [onCreateOverride]);

  const handleFieldApply = useCallback((value: string) => {
    if (!editPopover) return;
    // Blanks IA genéricos no son campos mapeados: persistirlos como
    // TextOverride con contexto para distinguir cada ocurrencia.
    if (editPopover.field === "__ai_blank__" && onCreateOverride) {
      // Buscar contexto alrededor del span clickeado para localizar la ocurrencia exacta.
      const spans = contentRef.current?.querySelectorAll('[data-field="__ai_blank__"]');
      let contextBefore = "";
      let contextAfter = "";
      if (spans) {
        for (const sp of Array.from(spans)) {
          const rect = (sp as HTMLElement).getBoundingClientRect();
          if (Math.abs(rect.top - editPopover.position.top + 4) < 2 &&
              Math.abs(rect.left - editPopover.position.left) < 2) {
            const prev = (sp.previousSibling?.textContent || "").slice(-30);
            const next = (sp.nextSibling?.textContent || "").slice(0, 30);
            contextBefore = prev;
            contextAfter = next;
            break;
          }
        }
      }
      onCreateOverride("___________", value, false, contextBefore, contextAfter);
      setEditPopover(null);
      return;
    }
    if (!onFieldEdit) return;
    onFieldEdit(editPopover.field, value, editPopover.value);
    setEditPopover(null);
  }, [editPopover, onFieldEdit, onCreateOverride]);

  const handleApplyOverride = useCallback((newText: string, replaceAll: boolean) => {
    if (!selectionToolbar || !onCreateOverride) return;
    onCreateOverride(
      selectionToolbar.text,
      newText,
      replaceAll,
      (selectionToolbar as any).contextBefore || "",
      (selectionToolbar as any).contextAfter || ""
    );
    setSelectionToolbar(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionToolbar, onCreateOverride]);

  const handleAcceptSugerencia = useCallback(() => {
    if (!sugerenciaPopover || !onSugerenciaAccepted) return;
    onSugerenciaAccepted(sugerenciaPopover.idx, sugerenciaPopover.sugerencia.texto_sugerido);
    setSugerenciaPopover(null);
  }, [sugerenciaPopover, onSugerenciaAccepted]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <FileText className="h-12 w-12 text-destructive/40" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // Generating skeleton state
  if (generating) {
    return (
      <div ref={containerRef} className="relative flex flex-col h-full bg-muted">
        <div className="flex-1 min-h-0 overflow-auto p-4 flex justify-center items-start">
          <div
            className="shrink-0 mt-2 mb-2"
            style={{ width: `${PAGE_WIDTH * scale}px`, height: `${PAGE_HEIGHT * scale}px` }}
          >
            <div
              className="bg-white rounded shadow-md"
              style={{
                width: `${PAGE_WIDTH}px`,
                height: `${PAGE_HEIGHT}px`,
                padding: `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              <div className="space-y-4">
                {/* Title skeleton */}
                <div className="flex justify-center mb-6">
                  <Skeleton className="h-5 w-64" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-10/12" />
                <div className="py-2" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-9/12" />
                <div className="py-2" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-7/12" />
                <div className="py-2" />
                <Skeleton className="h-4 w-52" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-10/12" />
              </div>
            </div>
          </div>
        </div>
        {/* Loading message bar */}
        <div
          className="flex items-center justify-center gap-3 border-t border-border bg-background px-4"
          style={{ height: `${NAV_BAR_HEIGHT}px` }}
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">
            Redactando documento con IA…
          </span>
        </div>
      </div>
    );
  }

  if (loading && !html) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Generando vista previa…</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex flex-col h-full bg-muted">
      {/* Banner: missing notaria config — only show if no config AND no extracted data */}
      {!notariaConfig?.nombre_notaria && !extractedDocumento?.notaria_origen && (
        <div className="flex items-start gap-2 bg-primary/10 border border-primary/20 text-foreground text-xs px-3 py-2 mx-2 mt-2 rounded">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>
            Configure los datos de su notaría en <strong>Ajustes</strong> para completar automáticamente los campos del notario en el documento.
          </span>
        </div>
      )}
      {/* Coherence banner: notary mismatch */}
      {extractedDocumento?.notaria_origen && notariaConfig?.nombre_notaria &&
        extractedDocumento.notaria_origen.toLowerCase().trim() !== notariaConfig.nombre_notaria.toLowerCase().trim() && (
        <div className="flex items-start gap-2 bg-accent/20 border border-accent/40 text-accent-foreground text-xs px-3 py-2 mx-2 mt-2 rounded">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-accent-foreground" />
          <span>
            El certificado de tradición menciona <strong>{extractedDocumento.notaria_origen}</strong>, pero tu notaría configurada es <strong>{notariaConfig.nombre_notaria}</strong>. Esto es normal si el inmueble fue previamente escriturado en otra notaría.
          </span>
        </div>
      )}
      {/* measureRef removed — page count now derived from contentRef.scrollWidth */}

      {/* Single page view */}
      <div className="flex-1 min-h-0 overflow-auto p-4 flex justify-center items-start" style={{ overscrollBehavior: 'contain' }}>
        <div
          className="shrink-0"
          style={{
            height: `${PAGE_HEIGHT * scale}px`,
            width: `${PAGE_WIDTH * scale}px`,
            marginTop: "8px",
            marginBottom: "8px",
          }}
        >
          <div
            className="bg-white rounded shadow-md"
            style={{
              width: `${PAGE_WIDTH}px`,
              height: `${PAGE_HEIGHT}px`,
              padding: `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`,
              overflow: "hidden",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <div style={{ height: `${CONTENT_HEIGHT}px`, overflow: "hidden" }}>
              <div
                ref={contentRef}
                className="prose prose-sm max-w-none docx-columns-page"
                style={{
                  fontFamily: "'Times New Roman', serif",
                  fontSize: "13px",
                  lineHeight: "1.8",
                  color: "#1a1a1a",
                  columnWidth: `${PAGE_WIDTH - PAGE_PADDING_X * 2}px`,
                  columnGap: "0px",
                  columnFill: "auto" as any,
                  height: `${CONTENT_HEIGHT}px`,
                  transform: `translateX(-${currentPage * (PAGE_WIDTH - PAGE_PADDING_X * 2)}px)`,
                }}
                dangerouslySetInnerHTML={{ __html: html }}
                onClick={handleContentClick}
                onMouseUp={handleMouseUp}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Navigation bar */}
      <div
        className="flex items-center justify-center gap-3 border-t border-border bg-background px-4"
        style={{ height: `${NAV_BAR_HEIGHT}px` }}
      >
        {sugerenciasIA.length > 0 && (
          <span className="text-xs text-muted-foreground mr-2 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-orange-500" />
            {sugerenciasIA.filter(s => s.tipo === "discrepancia").length} discrepancias
            <Palette className="h-3 w-3 text-blue-500 ml-1" />
            {sugerenciasIA.filter(s => s.tipo === "estilo").length} estilos
          </span>
        )}
        {overrides.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <Pencil className="h-3 w-3" />
                Cambios ({overrides.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2" side="top">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Ediciones manuales</p>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {overrides.map((ov) => (
                  <div key={ov.id} className="flex items-start justify-between gap-2 text-xs rounded-md p-1.5 bg-muted/50">
                    <div className="min-w-0 flex-1">
                      <span className="line-through text-muted-foreground">"{ov.originalText.slice(0, 25)}{ov.originalText.length > 25 ? "…" : ""}"</span>
                      <span className="mx-1 text-muted-foreground">→</span>
                      <span className="font-medium" style={{ color: "#4c1d95" }}>"{ov.newText.slice(0, 25)}{ov.newText.length > 25 ? "…" : ""}"</span>
                    </div>
                    {onRemoveOverride && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => onRemoveOverride(ov.id)}
                      >
                        <Undo2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
          disabled={currentPage === 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium text-muted-foreground min-w-[120px] text-center">
          Página {currentPage + 1} de {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))}
          disabled={currentPage === pageCount - 1}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Edit popover */}
      {editPopover && (
        <VariableEditPopover
          fieldName={editPopover.field}
          currentValue={editPopover.value}
          position={editPopover.position}
          suggestion={editPopover.suggestion}
          onApply={handleFieldApply}
          onClose={() => setEditPopover(null)}
          onGotoForm={
            onScrollToField && FORM_FIELDS.has(editPopover.field)
              ? () => {
                  const f = editPopover.field;
                  setEditPopover(null);
                  onScrollToField(f);
                }
              : undefined
          }
        />
      )}

      {/* Inline edit toolbar */}
      {selectionToolbar && (
        <InlineEditToolbar
          selectedText={selectionToolbar.text}
          position={selectionToolbar.position}
          occurrenceCount={selectionToolbar.occurrenceCount}
          onApply={handleApplyOverride}
          onClose={() => {
            setSelectionToolbar(null);
            setScrollToOccurrence(null);
          }}
          replacements={buildReplacements()}
          existingOverrides={overrides}
          onNavigate={(index) => {
            setScrollToOccurrence(
              selectionToolbar ? { text: selectionToolbar.text, index } : null
            );
          }}
          onApplyAtIndex={(newText, index) => {
            if (!onCreateOverride) return;
            onCreateOverride(
              selectionToolbar.text,
              newText,
              false,
              selectionToolbar.contextBefore || "",
              selectionToolbar.contextAfter || ""
            );
          }}
        />
      )}

      {/* Sugerencia popover */}
      {sugerenciaPopover && (
        <SugerenciaPopover
          sugerencia={sugerenciaPopover.sugerencia}
          position={sugerenciaPopover.position}
          onAccept={handleAcceptSugerencia}
          onIgnore={() => setSugerenciaPopover(null)}
        />
      )}
    </div>
  );
};

/** Apply <mark> highlights for AI suggestions */
function applySugerenciaHighlights(html: string, sugerencias: SugerenciaIA[]): string {
  let result = html;
  for (let i = 0; i < sugerencias.length; i++) {
    const sug = sugerencias[i];
    const escaped = sug.texto_original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const markStyle = sug.tipo === "discrepancia"
      ? "background:#fed7aa;border-bottom:2px solid #f97316;cursor:pointer;padding:0 2px;border-radius:2px"
      : "background:#bfdbfe;border-bottom:2px solid #3b82f6;cursor:pointer;padding:0 2px;border-radius:2px";
    
    result = result.replace(
      new RegExp(escaped, "i"),
      `<mark data-sugerencia-idx="${i}" style="${markStyle}">${sug.texto_original}</mark>`
    );
  }
  return result;
}

/** Popover for AI suggestions */
function SugerenciaPopover({
  sugerencia,
  position,
  onAccept,
  onIgnore,
}: {
  sugerencia: SugerenciaIA;
  position: { top: number; left: number };
  onAccept: () => void;
  onIgnore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onIgnore();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onIgnore();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onIgnore]);

  const isDiscrepancia = sugerencia.tipo === "discrepancia";

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-80 rounded-lg border bg-popover p-3 shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ top: position.top, left: Math.min(position.left, window.innerWidth - 340) }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        {isDiscrepancia ? (
          <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
        ) : (
          <Palette className="h-3.5 w-3.5 text-blue-500" />
        )}
        <span className="text-xs font-semibold" style={{ color: isDiscrepancia ? "#f97316" : "#3b82f6" }}>
          {isDiscrepancia ? "Discrepancia detectada" : "Ajuste de estilo"}
        </span>
      </div>

      <p className="text-xs text-muted-foreground mb-2">{sugerencia.mensaje}</p>

      <div className="rounded bg-muted/50 px-2 py-1.5 mb-3">
        <p className="text-xs text-muted-foreground line-through mb-0.5">{sugerencia.texto_original}</p>
        <p className="text-xs font-medium text-foreground">{sugerencia.texto_sugerido}</p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={onAccept}>
          <Check className="h-3 w-3 mr-1" /> Aceptar
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs flex-1" onClick={onIgnore}>
          <X className="h-3 w-3 mr-1" /> Ignorar
        </Button>
      </div>
    </div>
  );
}

export default DocxPreview;
