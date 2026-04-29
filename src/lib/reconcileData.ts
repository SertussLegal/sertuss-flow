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

/**
 * Extracts atomic civil status from raw OCR text, stripping notarial boilerplate.
 */
export function sanitizeEstadoCivil(raw: string): string {
  if (!raw) return "";
  const lower = stripAccents(raw.toLowerCase()).replace(/\s+/g, " ").trim();
  const re = /(soltera?|casada?|divorciada?|viuda?|union (?:marital|libre)(?: de hecho)?)(\s+(?:sin|con)\s+(?:union marital(?: de hecho)?|sociedad conyugal(?: vigente| disuelta| liquidada)?))?/;
  const match = lower.match(re);
  if (!match) return "";
  return match[0].replace(/\bunion\b/g, "unión").trim();
}

/**
 * Returns a clean postal address or empty string.
 * Discards generic boilerplate and requires at least one digit.
 */
export function sanitizeDireccion(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const lower = stripAccents(trimmed.toLowerCase()).replace(/\s+/g, " ").trim();
  const formulaic = new Set([
    "esta ciudad", "en esta ciudad",
    "domiciliado en esta ciudad", "domiciliada en esta ciudad", "domiciliados en esta ciudad",
    "en la ciudad", "esta localidad", "el municipio",
  ]);
  if (formulaic.has(lower)) return "";
  const stripped = trimmed.replace(/^domiciliad[oa]s?\s+en\s+/i, "").trim();
  if (!/\d/.test(stripped)) return "";
  return stripped;
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
      if (escrituraMatch.estado_civil && !enriched.estado_civil && !isDirty("estado_civil")) {
        enriched.estado_civil = escrituraMatch.estado_civil;
      }
      if (escrituraMatch.direccion && !enriched.direccion && !isDirty("direccion")) {
        enriched.direccion = escrituraMatch.direccion;
      }
      if (escrituraMatch.municipio_domicilio && !enriched.municipio_domicilio && !isDirty("municipio_domicilio")) {
        enriched.municipio_domicilio = escrituraMatch.municipio_domicilio;
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
