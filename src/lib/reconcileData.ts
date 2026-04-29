// ── Multi-Document Reconciliation Engine ──
// Crosses data between Certificado, Cédulas, Escritura and Predial
// using normalized CC as the ONLY matching key.

import type { Persona, Inmueble } from "@/lib/types";

export interface ReconcileAlert {
  tipo: "discrepancia" | "dato_faltante";
  mensaje: string;
  campo?: string;
}

/**
 * Normalizes a Colombian ID number by stripping dots, dashes, spaces and apostrophes.
 * "79.681.841" → "79681841"
 */
export function normalizeCC(cc: string): string {
  if (!cc) return "";
  return cc.replace(/[\.\s\-\']/g, "").trim();
}

/**
 * Normalizes a name for comparison (alerts only, never as match key).
 * Removes accents, uppercases, trims extra spaces.
 */
export function normalizeNameForComparison(name: string): string {
  if (!name) return "";
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Common Colombian female first names (heuristic complement to "ends with a")
const FEMALE_FIRST_NAMES = new Set([
  "maria","ana","luz","luisa","carmen","rosa","esperanza","beatriz","patricia","claudia",
  "sandra","monica","martha","marta","gloria","adriana","diana","catalina","carolina",
  "natalia","paola","andrea","angela","alejandra","liliana","yolanda","mercedes","isabel",
  "elena","laura","valentina","camila","daniela","sofia","sara","juliana","ximena","gabriela",
  "clara","cecilia","consuelo","amparo","stella","ruth","nubia","fanny","blanca","helena",
  "ines","irene","lucia","margarita","matilde","olga","pilar","silvia","teresa","veronica",
  "zulma","yesenia","jenny","leidy","kelly","tatiana","viviana","yaneth","marcela",
]);

// Heuristic: returns true if the first name appears female.
function isFemaleName(fullName?: string): boolean {
  if (!fullName) return false;
  const first = stripAccents(fullName.trim().split(/\s+/)[0] || "").toLowerCase();
  if (!first) return false;
  if (FEMALE_FIRST_NAMES.has(first)) return true;
  // Default heuristic for Spanish names: ends with 'a' (with common exceptions).
  const masculineEndingA = new Set(["andrea","nicolas","tomas","lucas","matias","jeremias","elias","jonas"]);
  if (masculineEndingA.has(first)) return false;
  return first.endsWith("a");
}

/**
 * Extracts atomic civil status from raw OCR text, stripping notarial boilerplate.
 * Optionally normalizes gender suffix (o/a) based on the person's name.
 */
export function sanitizeEstadoCivil(raw: string, nombre?: string): string {
  if (!raw) return "";
  let lower = stripAccents(raw.toLowerCase()).replace(/\s+/g, " ").trim();
  // Strip known trash tokens before matching
  const trashPatterns = [
    /\bmayor(?:es)? de edad\b/g,
    /\bde nacionalidad [a-z]+\b/g,
    /\bidentificad[oa]s? (?:con|mediante)[^,;.]*/g,
    /\bdomiciliad[oa]s? en[^,;.]*/g,
    /\bvecin[oa]s? de[^,;.]*/g,
    /\bportador(?:es)? (?:de|del)[^,;.]*/g,
  ];
  for (const p of trashPatterns) lower = lower.replace(p, " ");
  lower = lower.replace(/\s+/g, " ").trim();

  const re = /(soltera?|casada?|divorciada?|viuda?|union (?:marital|libre)(?: de hecho)?)(\s+(?:sin|con)\s+(?:union marital(?: de hecho)?|sociedad conyugal(?: vigente| disuelta| liquidada)?))?/;
  const match = lower.match(re);
  if (!match) return "";
  let result = match[0].replace(/\bunion\b/g, "unión").trim();

  // Gender normalization based on name
  if (nombre) {
    const female = isFemaleName(nombre);
    result = result.replace(/\b(solter|casad|divorciad|viud)([oa])\b/g, (_m, root) => {
      return root + (female ? "a" : "o");
    });
  }
  return result;
}

// Vías urbanas oficiales (Colombia, DANE/SNR): formas largas + abreviaturas notariales.
// CL=Calle, KR/CR/CRA/KRA=Carrera, DG=Diagonal, TV=Transversal, AV=Avenida.
const URBAN_TOKEN_RE = /\b(calle|cll|cl|carrera|cra|cr|kra|kr|avenida|av|ave|diagonal|dg|diag|transversal|tv|trans|circular|circ|circunvalar|autopista|auto|peatonal|pasaje|pje)\b/i;
// Identificadores rurales válidos.
const RURAL_TOKEN_RE = /\b(vereda|corregimiento|kilometro|kil[oó]metro|km|via|v[ií]a|finca|hacienda|parcela|parcelaci[oó]n|lote|predio|sector|inspecci[oó]n)\b/i;
// Cualquier token (vía o rural) — se usa para localizar la "parte postal" dentro de un texto contextual.
const ANY_ADDRESS_TOKEN_RE = /\b(calle|cll|cl|carrera|cra|cr|kra|kr|avenida|av|ave|diagonal|dg|diag|transversal|tv|trans|circular|circ|circunvalar|autopista|auto|peatonal|pasaje|pje|vereda|corregimiento|kilometro|kil[oó]metro|km|v[ií]a|finca|hacienda|parcela|parcelaci[oó]n|lote|predio|sector|inspecci[oó]n)\b/i;

const FORMULAIC_ADDRESSES = new Set([
  "esta ciudad", "en esta ciudad",
  "domiciliado en esta ciudad", "domiciliada en esta ciudad", "domiciliados en esta ciudad",
  "en la ciudad", "esta localidad", "el municipio", "este municipio",
  "residente en esta ciudad", "residente en la ciudad",
  "residente de este municipio", "residente en este municipio",
  "vecino de esta ciudad", "vecina de esta ciudad",
]);

/**
 * Returns a clean Colombian postal/rural address or empty string.
 *
 * Orden de limpieza (estricto):
 *  1) Quitar prefijos contextuales ("domiciliado en…", "residente de…", "con domicilio en…").
 *  2) Separación de contexto: si va precedida por la ciudad ("en Bogotá en la Calle 10…"),
 *     conservar solo desde el primer token de vía/rural.
 *  3) Buscar tokens (urbano o rural). Si no hay → "".
 *  4) Validar: urbano exige dígito; rural exige nombre propio o número.
 */
export function sanitizeDireccion(raw: string): string {
  if (!raw) return "";

  // 1) Prefijos contextuales
  let candidate = raw.trim().replace(/\s+/g, " ");
  candidate = candidate.replace(/^(?:y\s+|,\s*|;\s*)+/i, "").trim();
  candidate = candidate
    .replace(/^(?:domiciliad[oa]s?|residentes?|vecin[oa]s?|con\s+domicilio)\s+(?:en\s+|de\s+)?/i, "")
    .trim();

  // Boilerplate exacto tras quitar prefijos
  const lowerEarly = stripAccents(candidate.toLowerCase());
  if (FORMULAIC_ADDRESSES.has(lowerEarly)) return "";

  // 2) Separación de contexto: si hay texto antes del primer token, recortar.
  const tokenMatch = candidate.match(ANY_ADDRESS_TOKEN_RE);
  if (tokenMatch && typeof tokenMatch.index === "number" && tokenMatch.index > 0) {
    const head = candidate.slice(0, tokenMatch.index);
    if (/[a-záéíóúñ]/i.test(head)) {
      candidate = candidate.slice(tokenMatch.index).trim();
    }
  }

  // 3) Si no hay token de vía o rural → vacío (prohibición de alucinación).
  const hasUrban = URBAN_TOKEN_RE.test(candidate);
  const hasRural = RURAL_TOKEN_RE.test(candidate);
  if (!hasUrban && !hasRural) return "";

  // 4) Validación
  const hasDigit = /\d/.test(candidate);
  if (hasUrban && !hasRural && !hasDigit) return "";
  if (!hasUrban && hasRural) {
    const cleaned = candidate.replace(RURAL_TOKEN_RE, "").trim();
    if (cleaned.length < 3 && !hasDigit) return "";
  }

  // Re-chequeo final de boilerplate por si quedó tras el recorte.
  const lowerFinal = stripAccents(candidate.toLowerCase()).replace(/\s+/g, " ").trim();
  if (FORMULAIC_ADDRESSES.has(lowerFinal)) return "";

  return candidate.replace(/[\s,;]+$/g, "").trim();
}

/**
 * Returns a clean municipality name or empty string.
 */
export function sanitizeMunicipio(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const lower = stripAccents(trimmed.toLowerCase()).replace(/\s+/g, " ").trim();
  const generic = new Set([
    "esta ciudad", "en esta ciudad", "el municipio",
    "este municipio", "esta localidad", "la ciudad",
  ]);
  if (generic.has(lower)) return "";
  return trimmed;
}

interface CedulaDetail {
  nombre_completo?: string;
  numero_identificacion?: string;
  numero_cedula?: string;
  lugar_expedicion?: string;
  municipio_expedicion?: string;
  [key: string]: any;
}

interface EscrituraCompareciente {
  nombre?: string;
  cedula?: string;
  rol?: string;
  estado_civil?: string;
  direccion?: string;
  municipio_domicilio?: string;
  [key: string]: any;
}

/**
 * Reconciles personas from multiple document sources.
 * Priority: Escritura > Cédula > Certificado
 * Only fills EMPTY fields that are NOT in dirtyFields.
 */
export function reconcilePersonas(
  formPersonas: Persona[],
  cedulasDetail: CedulaDetail[],
  escrituraComparecientes: EscrituraCompareciente[],
  dirtyFields: Set<string>
): { updated: Persona[]; alerts: ReconcileAlert[] } {
  const alerts: ReconcileAlert[] = [];
  
  const updated = formPersonas.map(persona => {
    const cc = normalizeCC(persona.numero_cedula);
    if (!cc) return persona;

    let enriched = { ...persona };
    const isDirty = (field: string) => dirtyFields.has(field);

    // 1. Match against cédulas escaneadas → lugar_expedicion
    const cedulaMatch = cedulasDetail.find(c => {
      const cedulaCC = normalizeCC(c.numero_identificacion || c.numero_cedula || "");
      return cedulaCC === cc;
    });

    if (cedulaMatch) {
      const lugar = cedulaMatch.lugar_expedicion || cedulaMatch.municipio_expedicion || "";
      if (lugar && !enriched.lugar_expedicion && !isDirty("lugar_expedicion")) {
        enriched.lugar_expedicion = lugar;
      }

      // Name discrepancy alert
      const certName = normalizeNameForComparison(persona.nombre_completo);
      const cedulaName = normalizeNameForComparison(cedulaMatch.nombre_completo || "");
      if (certName && cedulaName && certName !== cedulaName) {
        alerts.push({
          tipo: "discrepancia",
          mensaje: `El certificado dice "${persona.nombre_completo}" pero la cédula dice "${cedulaMatch.nombre_completo}". Verifica cuál es el nombre correcto.`,
          campo: "nombre_completo",
        });
      }
    }

    // 2. Match against escritura comparecientes → estado_civil, direccion, municipio_domicilio
    // The Escritura (Comparecencia) is the SOURCE OF TRUTH for these fields
    const escrituraMatch = escrituraComparecientes.find(c => {
      const compCC = normalizeCC(c.cedula || "");
      return compCC === cc;
    });

    if (escrituraMatch) {
      const cleanEstado = sanitizeEstadoCivil(escrituraMatch.estado_civil || "", enriched.nombre_completo || escrituraMatch.nombre || "");
      if (cleanEstado && !enriched.estado_civil && !isDirty("estado_civil")) {
        enriched.estado_civil = cleanEstado;
      }
      const cleanDir = sanitizeDireccion(escrituraMatch.direccion || "");
      if (cleanDir && !enriched.direccion && !isDirty("direccion")) {
        enriched.direccion = cleanDir;
      }
      const cleanMun = sanitizeMunicipio(escrituraMatch.municipio_domicilio || "");
      if (cleanMun && !enriched.municipio_domicilio && !isDirty("municipio_domicilio")) {
        enriched.municipio_domicilio = cleanMun;
      }
    }

    return enriched;
  });

  // Check for personas without any matching cédula
  for (const persona of formPersonas) {
    const cc = normalizeCC(persona.numero_cedula);
    if (!cc) continue;
    const hasCedula = cedulasDetail.some(c => 
      normalizeCC(c.numero_identificacion || c.numero_cedula || "") === cc
    );
    if (!hasCedula) {
      alerts.push({
        tipo: "dato_faltante",
        mensaje: `No se encontró cédula escaneada para ${persona.nombre_completo || "persona"} (CC ${persona.numero_cedula}). Estado civil y dirección podrían quedar vacíos.`,
        campo: "cedula",
      });
    }
  }

  return { updated, alerts };
}

/**
 * Reconciles inmueble data from predial extraction.
 * Only fills empty fields not in dirtyFields.
 */
export function reconcileInmueble(
  inmueble: Inmueble,
  predialData: Record<string, any> | null | undefined,
  dirtyFields: Set<string>
): Inmueble {
  if (!predialData) return inmueble;

  const result = { ...inmueble };
  const isDirty = (field: string) => dirtyFields.has(field);

  if (predialData.avaluo_catastral && !result.avaluo_catastral && !isDirty("avaluo_catastral")) {
    result.avaluo_catastral = String(predialData.avaluo_catastral);
  }
  if (predialData.estrato && !result.estrato && !isDirty("estrato")) {
    result.estrato = String(predialData.estrato);
  }
  if (predialData.area && !result.area && !isDirty("area")) {
    result.area = String(predialData.area);
  }
  if (predialData.direccion && !result.direccion && !isDirty("direccion")) {
    result.direccion = String(predialData.direccion);
  }

  return result;
}
