import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, ChevronLeft, ChevronRight, AlertTriangle, Palette, Check, X } from "lucide-react";
import type { Persona, Inmueble, Actos, CustomVariable, SugerenciaIA } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import VariableEditPopover from "./VariableEditPopover";
import SelectionToolbar from "./SelectionToolbar";
import DOMPurify from "dompurify";

interface NotariaConfig {
  nombre_notaria: string; ciudad: string; notario_titular: string; estilo_linderos: string;
  numero_notaria: number | null; circulo: string; departamento: string; tipo_notario: string;
  nombre_notario: string; decreto_nombramiento: string;
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
          cedula: p.numero_cedula || "___________",
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
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        const normalized = normalizeTemplateTags(result.value);
        
        // DIAGNOSTIC: Log all placeholders found in the template HTML
        const templatePlaceholders = normalized.match(/\{[a-zA-Z_#/^][a-zA-Z0-9_.#/^]*\}/g) || [];
        console.log("=== DOCX PREVIEW: Placeholders in template ===", templatePlaceholders);
        
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
      "area": inmueble.area || "___________",
      "inmueble.area": inmueble.area || "___________",
      "linderos": inmueble.linderos || "___________",
      "avaluo_catastral": inmueble.avaluo_catastral || "___________",
      "inmueble.avaluo_catastral": inmueble.avaluo_catastral || "___________",
      "codigo_orip": inmueble.codigo_orip || "___________",
      "inmueble.orip_ciudad": inmueble.codigo_orip || "___________",
      "inmueble.orip_zona": inmueble.codigo_orip || "___________",
      // Inmueble extended
      "nupre": (inmueble as any).nupre || "___________",
      "inmueble.nupre": (inmueble as any).nupre || "___________",
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
      "estrato": (inmueble as any).estrato || "___________",
      "inmueble.estrato": (inmueble as any).estrato || "___________",
      "inmueble.nombre_edificio_conjunto": (inmueble as any).nombre_edificio_conjunto || "___________",
      "inmueble.coeficiente_letras": (inmueble as any).coeficiente_letras || "___________",
      "inmueble.coeficiente_numero": (inmueble as any).coeficiente_numero || "___________",
      // Actos
      "tipo_acto": actos.tipo_acto || "___________",
      "valor_compraventa_letras": actos.valor_compraventa || "___________",
      "actos.cuantia_compraventa_letras": actos.valor_compraventa || "___________",
      "actos.cuantia_compraventa_numero": actos.valor_compraventa || "___________",
      "actos.cuantia_hipoteca_letras": actos.valor_hipoteca || "___________",
      "actos.cuantia_hipoteca_numero": actos.valor_hipoteca || "___________",
      "entidad_bancaria": actos.entidad_bancaria || "___________",
      "actos.entidad_bancaria": actos.entidad_bancaria || "___________",
      "actos.entidad_domicilio": "___________",
      "actos.entidad_nit": "___________",
      "valor_hipoteca_letras": actos.valor_hipoteca || "___________",
      "actos.valor_hipoteca_letras": actos.valor_hipoteca || "___________",
      "actos.valor_hipoteca_numero": actos.valor_hipoteca || "___________",
      "actos.fecha_escritura_letras": "___________",
      "actos.pago_inicial_letras": "___________",
      "actos.pago_inicial_numero": "___________",
      "actos.saldo_financiado_letras": "___________",
      "actos.saldo_financiado_numero": "___________",
      "actos.credito_dia_letras": "___________",
      "actos.credito_dia_num": "___________",
      "actos.credito_mes": "___________",
      "actos.credito_anio_letras": "___________",
      "actos.credito_anio_num": "___________",
      "actos.redam_resultado": "___________",
      // Inmueble extended
      "inmueble.predial_anio": "___________",
      "inmueble.predial_num": "___________",
      "inmueble.predial_valor": "___________",
      "inmueble.idu_num": "___________",
      "inmueble.idu_fecha": "___________",
      "inmueble.idu_vigencia": "___________",
      "inmueble.admin_fecha": "___________",
      "inmueble.admin_vigencia": "___________",
      // RPH (propiedad horizontal)
      "rph.escritura": inmueble.escritura_ph || "___________",
      "rph.escritura_num_letras": "___________",
      "rph.escritura_num_numero": "___________",
      "rph.escritura_dia_letras": "___________",
      "rph.escritura_dia_num": "___________",
      "rph.escritura_mes": "___________",
      "rph.escritura_anio_letras": "___________",
      "rph.escritura_anio_num": "___________",
      "rph.notaria": notariaConfig?.nombre_notaria || "___________",
      "rph.notaria_numero": notariaConfig?.numero_notaria?.toString() || "___________",
      "rph.notaria_ciudad": notariaConfig?.ciudad || "___________",
      "rph.matricula_matriz": "___________",
      // Antecedentes
      "antecedentes.modo": "___________",
      "antecedentes.modo_adquisicion": "___________",
      "antecedentes.adquirido_de": "___________",
      "antecedentes.escritura": "___________",
      "antecedentes.escritura_num_letras": "___________",
      "antecedentes.escritura_num_numero": "___________",
      "antecedentes.escritura_dia_letras": "___________",
      "antecedentes.escritura_dia_num": "___________",
      "antecedentes.escritura_mes": "___________",
      "antecedentes.escritura_anio_letras": "___________",
      "antecedentes.escritura_anio_num": "___________",
      "antecedentes.notaria": "___________",
      "antecedentes.notaria_previa_numero": "___________",
      "antecedentes.notaria_previa_circulo": "___________",
      "antecedentes.fecha": "___________",
      // Apoderado banco
      "apoderado_banco.nombre": actos.apoderado_nombre || "___________",
      "apoderado_banco.cedula": actos.apoderado_cedula || "___________",
      "apoderado_banco.expedida_en": "___________",
      "apoderado_banco.escritura_poder_num": "___________",
      "apoderado_banco.poder_dia_letras": "___________",
      "apoderado_banco.poder_dia_num": "___________",
      "apoderado_banco.poder_mes": "___________",
      "apoderado_banco.poder_anio_letras": "___________",
      "apoderado_banco.poder_anio_num": "___________",
      "apoderado_banco.notaria_poder_num": "___________",
      "apoderado_banco.notaria_poder_ciudad": "___________",
      "apoderado_banco.email": "___________",
      // Notario — from notaria config
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

    // DIAGNOSTIC: Log replacement keys and which ones have values
    const filled = Object.entries(replacements).filter(([, v]) => v !== "___________").map(([k, v]) => `${k}=${v.substring(0, 40)}`);
    const empty = Object.entries(replacements).filter(([, v]) => v === "___________").map(([k]) => k);
    console.log("=== DOCX PREVIEW: buildReplacements ===");
    console.log("Filled:", filled);
    console.log("Empty:", empty);

    return replacements;
  }, [vendedores, compradores, inmueble, actos]);

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
          result = result.replace(
            new RegExp(`\\{${escaped}\\}`, "g"),
            `<span data-field="${key}" class="var-pending" style="background:#fef3c7;text-decoration:underline;cursor:pointer">___________</span>`
          );
        }
      }

      // Clean remaining loop markers and unmapped placeholders
      result = result.replace(/\{[#/^][^}]*\}/g, "");
      result = result.replace(/\{[a-zA-Z_][a-zA-Z0-9_.]*\}/g, '<span class="var-pending" style="background:#fef3c7;text-decoration:underline">___________</span>');

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

      setHtml(sanitize(result));
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [baseHtml, buildReplacements, customVariables, textoFinalWord, sugerenciasIA]);

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
    if (field && onFieldEdit) {
      const text = target.textContent || "";
      const rect = target.getBoundingClientRect();
      setSelectionToolbar(null);
      setSugerenciaPopover(null);
      setEditPopover({
        field,
        value: text,
        position: { top: rect.bottom + 4, left: Math.max(8, rect.left) },
      });
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
  }, [onFieldEdit, customVariables, sugerenciasIA]);

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
