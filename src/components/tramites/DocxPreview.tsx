import { useState, useEffect, useRef, useCallback } from "react";
import { lookupBank } from "@/lib/bankDirectory";
import { formatMonedaLegal, formatFechaLegal, formatCedulaLegal } from "@/lib/legalFormatters";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, ChevronLeft, ChevronRight, AlertTriangle, Palette, Check, X, Info } from "lucide-react";
import type { Persona, Inmueble, Actos, CustomVariable, SugerenciaIA } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import VariableEditPopover from "./VariableEditPopover";
import SelectionToolbar from "./SelectionToolbar";
import DOMPurify from "dompurify";
import mammoth from "mammoth";

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
  customVariables?: CustomVariable[];
  onFieldEdit?: (field: string, value: string) => void;
  onCreateCustomVariable?: (originalText: string, variableName: string) => void;
  sugerenciasIA?: SugerenciaIA[];
  generating?: boolean;
  textoFinalWord?: string;
  onSugerenciaAccepted?: (idx: number, textoSugerido: string) => void;
  notariaConfig?: NotariaConfig | null;
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
    "class", "style", "data-field", "data-custom-var", "data-sugerencia-idx",
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

const DocxPreview = ({
  vendedores,
  compradores,
  inmueble,
  actos,
  customVariables = [],
  onFieldEdit,
  onCreateCustomVariable,
  sugerenciasIA = [],
  generating = false,
  textoFinalWord,
  onSugerenciaAccepted,
  notariaConfig,
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
  const measureRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Edit popover state
  const [editPopover, setEditPopover] = useState<{
    field: string;
    value: string;
    position: { top: number; left: number };
  } | null>(null);

  // Selection toolbar state
  const [selectionToolbar, setSelectionToolbar] = useState<{
    text: string;
    position: { top: number; left: number };
  } | null>(null);

  // Sugerencia popover state
  const [sugerenciaPopover, setSugerenciaPopover] = useState<{
    idx: number;
    sugerencia: SugerenciaIA;
    position: { top: number; left: number };
  } | null>(null);

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
      // Notario — from notaria config, fallback to extractedDocumento
      "notario_nombre": notariaConfig?.nombre_notario || notariaConfig?.notario_titular || "___________",
      "notario_decreto": notariaConfig?.decreto_nombramiento || "___________",
      "notario_tipo": notariaConfig?.tipo_notario || "___________",
      "notaria_nombre": notariaConfig?.nombre_notaria || "___________",
      "notaria_ciudad": notariaConfig?.ciudad || "___________",
      "notaria_circulo": notariaConfig?.circulo || "___________",
      "notaria_departamento": notariaConfig?.departamento || "___________",
      "notaria_numero": notariaConfig?.numero_notaria?.toString() || "___________",
      "escritura_numero": "___________",
      "fecha_escritura_corta": "___________",
    };

    return replacements;
  }, [vendedores, compradores, inmueble, actos, notariaConfig, extractedDocumento, extractedPredial]);

  // Apply replacements or use textoFinalWord
  useEffect(() => {
    // If we have AI-generated text, use it instead of template
    if (textoFinalWord) {
      let result = textoFinalWord;
      
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
        if (value && value !== "___________") {
          result = result.replace(
            new RegExp(`\\{${escaped}\\}`, "g"),
            `<span data-field="${key}" class="var-resolved" style="color:#065f46;font-weight:bold;cursor:pointer;border-bottom:1px dashed #065f46">${value}</span>`
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

      // Clean remaining loop markers and unmapped placeholders
      result = result.replace(/\{[#/^][^}]*\}/g, "");
      result = result.replace(/\{[a-zA-Z_][a-zA-Z0-9_.]*\}/g, `<span class="var-pending" style="${pendingRedStyle}">___________</span>`);

      // Apply custom variables
      for (const cv of customVariables) {
        if (cv.originalText) {
          const escapedText = cv.originalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const replacement = cv.value
            ? `<span data-custom-var="${cv.id}" class="var-resolved" style="color:#065f46;font-weight:bold;cursor:pointer;border-bottom:1px dashed #065f46">${cv.value}</span>`
            : `<span data-custom-var="${cv.id}" class="var-pending" style="background:#fef3c7;text-decoration:underline;cursor:pointer">${cv.originalText}</span>`;
          result = result.replace(new RegExp(escapedText, "g"), replacement);
        }
      }

      // FINAL PASS: Unify ALL remaining bare ___________ (from persona loops, resolved spans containing gaps, etc.)
      // First: fix ___________ inside resolved spans (split into resolved + pending parts)
      result = result.replace(
        /<span([^>]*class="var-resolved"[^>]*)>([^<]*___________[^<]*)<\/span>/g,
        (_, attrs, content) => {
          // Split the content on ___________ and rebuild with mixed spans
          const parts = content.split("___________");
          return parts.map((part: string, i: number) => {
            const resolved = part ? `<span${attrs}>${part}</span>` : "";
            const pending = i < parts.length - 1
              ? '<span class="var-pending" style="background:hsl(0 84% 95%);color:hsl(0 72% 51%);text-decoration:underline;cursor:pointer">___________</span>'
              : "";
            return resolved + pending;
          }).join("");
        }
      );
      // Then: wrap any remaining bare ___________ not already inside a span
      // Use split/join instead of lookbehind for Safari compatibility
      const pendingSpan = '<span class="var-pending" style="background:hsl(0 84% 95%);color:hsl(0 72% 51%);text-decoration:underline;cursor:pointer">___________</span>';
      result = result.split("___________").map((segment, i, arr) => {
        if (i === arr.length - 1) return segment;
        // Check if this ___________ is already inside a span tag (look back for unclosed <span)
        const lastOpenSpan = segment.lastIndexOf("<span");
        const lastCloseSpan = segment.lastIndexOf("</span>");
        const isInsideSpan = lastOpenSpan > lastCloseSpan && !segment.slice(lastOpenSpan).includes("</span>");
        if (isInsideSpan) return segment + "___________";
        return segment + pendingSpan;
      }).join("");

      setHtml(sanitize(result));
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [baseHtml, buildReplacements, customVariables, textoFinalWord, sugerenciasIA, slotsPendientes]);

  // Measure content and compute pages
  useEffect(() => {
    if (!html || !measureRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (measureRef.current) {
        const totalHeight = measureRef.current.scrollHeight;
        const newPageCount = Math.max(1, Math.ceil(totalHeight / CONTENT_HEIGHT));
        setPageCount(newPageCount);
        setCurrentPage((prev) => Math.min(prev, newPageCount - 1));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [html]);

  // Handle click on variable spans and sugerencia marks
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Check for sugerencia click
    const sugerenciaIdx = target.getAttribute("data-sugerencia-idx");
    if (sugerenciaIdx !== null && sugerenciasIA.length > 0) {
      const idx = parseInt(sugerenciaIdx, 10);
      const sug = sugerenciasIA[idx];
      if (sug) {
        const rect = target.getBoundingClientRect();
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
    const field = target.getAttribute("data-field");
    if (field) {
      const text = target.textContent || "";
      // If pending (empty) field → scroll to the form input
      if (text === "___________" && onScrollToField) {
        onScrollToField(field);
        return;
      }
      // Otherwise open edit popover
      if (onFieldEdit) {
        const rect = target.getBoundingClientRect();
        setSelectionToolbar(null);
        setSugerenciaPopover(null);
        setEditPopover({
          field,
          value: text,
          position: { top: rect.bottom + 4, left: Math.max(8, rect.left) },
        });
      }
      return;
    }

    // Check for custom variable click
    const customVarId = target.getAttribute("data-custom-var");
    if (customVarId && onFieldEdit) {
      const cv = customVariables.find((v) => v.id === customVarId);
      if (cv) {
        const rect = target.getBoundingClientRect();
        setSelectionToolbar(null);
        setSugerenciaPopover(null);
        setEditPopover({
          field: `__custom__${cv.id}`,
          value: cv.value || cv.originalText,
          position: { top: rect.bottom + 4, left: Math.max(8, rect.left) },
        });
      }
    }
  }, [onFieldEdit, onScrollToField, customVariables, sugerenciasIA]);

  // Handle text selection for creating new variables
  const handleMouseUp = useCallback(() => {
    if (!onCreateCustomVariable) return;

    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

      const anchorNode = selection.anchorNode;
      if (!contentRef.current || !anchorNode || !contentRef.current.contains(anchorNode)) return;

      const anchorEl = anchorNode.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : (anchorNode as HTMLElement);
      if (anchorEl?.hasAttribute("data-field") || anchorEl?.hasAttribute("data-custom-var") || anchorEl?.hasAttribute("data-sugerencia-idx")) return;

      const text = selection.toString().trim();
      if (text.length < 2 || text.length > 200) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      setEditPopover(null);
      setSugerenciaPopover(null);
      setSelectionToolbar({
        text,
        position: { top: rect.bottom + 4, left: Math.max(8, rect.left) },
      });
    }, 10);
  }, [onCreateCustomVariable]);

  const handleFieldApply = useCallback((value: string) => {
    if (!editPopover || !onFieldEdit) return;
    onFieldEdit(editPopover.field, value);
    setEditPopover(null);
  }, [editPopover, onFieldEdit]);

  const handleCreateVariable = useCallback((variableName: string) => {
    if (!selectionToolbar || !onCreateCustomVariable) return;
    onCreateCustomVariable(selectionToolbar.text, variableName);
    setSelectionToolbar(null);
    window.getSelection()?.removeAllRanges();
  }, [selectionToolbar, onCreateCustomVariable]);

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
      {/* Hidden measuring container */}
      <div
        aria-hidden="true"
        className="absolute overflow-hidden"
        style={{ width: 0, height: 0, top: 0, left: 0 }}
      >
        <div
          ref={measureRef}
          className="prose prose-sm max-w-none pointer-events-none"
          style={{
            width: `${PAGE_WIDTH - PAGE_PADDING_X * 2}px`,
            fontFamily: "'Times New Roman', serif",
            fontSize: "13px",
            lineHeight: "1.8",
            color: "#1a1a1a",
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

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
                className="prose prose-sm max-w-none"
                style={{
                  fontFamily: "'Times New Roman', serif",
                  fontSize: "13px",
                  lineHeight: "1.8",
                  color: "#1a1a1a",
                  transform: `translateY(-${currentPage * CONTENT_HEIGHT}px)`,
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
          onApply={handleFieldApply}
          onClose={() => setEditPopover(null)}
        />
      )}

      {/* Selection toolbar */}
      {selectionToolbar && (
        <SelectionToolbar
          selectedText={selectionToolbar.text}
          position={selectionToolbar.position}
          existingVariables={[
            ...Object.keys(buildReplacements()),
            ...customVariables.map((cv) => cv.variableName),
          ]}
          onCreateVariable={handleCreateVariable}
          onClose={() => setSelectionToolbar(null)}
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
