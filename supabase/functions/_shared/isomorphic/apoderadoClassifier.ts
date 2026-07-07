// ============================================================================
// apoderadoClassifier — Enmienda 1 del Plan v7: Gobernanza Determinista.
//
// FUENTE ÚNICA DE VERDAD (isomórfica). Consumida por:
//   - Cliente (React): `src/lib/apoderadoClassifier.ts` (re-export)
//   - Edge (Deno):     `supabase/functions/_shared/apoderadoClassifier.ts` (shim)
//
// El código gobierna a la IA. Aunque el extractor devuelva
// `apoderado.tipo = "natural" | "juridica"`, este módulo aplica reglas
// duras que pueden DEGRADAR el resultado a `null` (ambiguo → captura humana).
//
// Motivos estables (nunca cambiar strings — se persisten en `system_events`):
//   - "corporate_keywords_in_natural_classification"
//   - "juridica_missing_constitution_data"
//   - "natural_missing_poder_data"
//   - "low_confidence_from_ocr"
//   - "no_apoderado_tipo_from_ocr"
//
// Pure TS, sin imports de Deno ni de browser ni de tipos autogenerados de BD.
// ============================================================================

export type TipoApoderado = "natural" | "juridica" | null;

export interface ApoderadoPayload {
  tipo?: TipoApoderado | string;
  nombre?: string | null;
  cargo?: string | null;
  cedula?: string | null;
  sociedad_razon_social?: string | null;
  sociedad_nit?: string | null;
  sociedad_constitucion?: {
    tipo_documento?: string | null;
    numero?: string | null;
    fecha?: string | null;
    fecha_texto?: string | null;
    camara_comercio_ciudad?: string | null;
    camara_comercio_fecha?: string | null;
    camara_comercio_numero?: string | null;
    libro?: string | null;
    razon_social_anterior?: string | null;
    reforma_acta_numero?: string | null;
    reforma_acta_fecha_texto?: string | null;
    reforma_camara_fecha_texto?: string | null;
  } | null;
  representantes?: Array<{
    nombre?: string;
    cedula?: string;
    cargo?: string;
    email?: string;
    es_firmante?: boolean;
  }>;
  /** Override manual del usuario. Cuando está fijado (natural|juridica), ignora todas las reglas de degradación. */
  tipo_override?: TipoApoderado | string;
  /** Escritura del poder — usado para la regla C (natural sin datos de escritura). */
  escritura_poder_num?: string | null;
  escritura_poder_fecha?: string | null;
  escritura_poder_notaria_num?: string | null;
  /** Confianza reportada por el extractor OCR. */
  _confianza_tipo?: "alta" | "media" | "baja" | null;
}

export interface ClassifierResult {
  tipoEfectivo: TipoApoderado;
  motivos: string[];
  /** true si el resultado provino del override manual del usuario. */
  fromOverride: boolean;
}

/**
 * Contexto opcional del extractor v6. Permite validar que el "natural"
 * tiene evidencia de un poder — ya sea el instrumento directo (poder general
 * del banco a persona natural) o la escritura de sustitución (cadena).
 */
export interface ClassifyContext {
  instrumento_poder?: {
    escritura_num?: string | null;
    fecha?: string | null;
    fecha_texto?: string | null;
    notaria_numero?: string | null;
    notaria_ciudad?: string | null;
  } | null;
  has_apoderado_banco_v3?: "true" | "false" | "null" | boolean | null;
}


// Palabras clave corporativas que contaminan una clasificación "natural"
// y disparan la degradación a null (Regla A).
const CORPORATE_PATTERNS: RegExp[] = [
  /\bS\.?\s*A\.?\s*S\.?\b/i,
  /\bS\.?\s*A\.?\b(?!\s*S)/i, // S.A. (no seguido de S para no atrapar SAS)
  /\bLtda\.?\b/i,
  /\bSAS\b/,
  /\bLTDA\b/,
  /Representante\s+Legal/i,
  /Suplente\s+del\s+Presidente/i,
  /\bNIT\.?\s*[:\-]?\s*\d/i,
  /apoderada?\s+general\s+de[^.]*\b(sociedad|S\.?A\.?)/i,
  /\ben\s+su\s+calidad\s+de\s+representante\s+legal/i,
];

function hasCorporateContamination(fields: Array<string | null | undefined>): boolean {
  for (const raw of fields) {
    if (!raw) continue;
    const s = String(raw);
    for (const re of CORPORATE_PATTERNS) {
      if (re.test(s)) return true;
    }
  }
  return false;
}

function isNonEmpty(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Clasificación efectiva del apoderado.
 *
 * Orden de precedencia:
 *   1. Override manual del usuario (humano > IA).
 *   2. Reglas de degradación defensiva → null si hay ambigüedad.
 *   3. Si no hay motivos de degradación, respeta el tipo propuesto por la IA.
 */
export function classifyApoderado(apo: ApoderadoPayload | null | undefined): ClassifierResult {
  if (!apo) {
    return { tipoEfectivo: null, motivos: ["no_apoderado_tipo_from_ocr"], fromOverride: false };
  }

  // (1) Override manual — humano gana siempre.
  const override = apo.tipo_override;
  if (override === "natural" || override === "juridica") {
    return { tipoEfectivo: override, motivos: [], fromOverride: true };
  }

  const tipoIA = apo.tipo === "natural" || apo.tipo === "juridica" ? apo.tipo : null;
  const motivos: string[] = [];

  // (2a) Confianza baja del OCR → null.
  if (apo._confianza_tipo === "baja") {
    motivos.push("low_confidence_from_ocr");
  }

  // (2b) Sin tipo propuesto → null explícito.
  if (!tipoIA) {
    if (motivos.length === 0) motivos.push("no_apoderado_tipo_from_ocr");
    return { tipoEfectivo: null, motivos, fromOverride: false };
  }

  // (2c) Regla A — "natural" contaminada con keywords corporativos.
  if (tipoIA === "natural") {
    if (hasCorporateContamination([apo.nombre, apo.cargo])) {
      motivos.push("corporate_keywords_in_natural_classification");
    }
    // Regla C — "natural" sin datos mínimos del poder.
    const faltaEscritura =
      !isNonEmpty(apo.escritura_poder_num) ||
      !isNonEmpty(apo.escritura_poder_fecha) ||
      !isNonEmpty(apo.escritura_poder_notaria_num);
    if (faltaEscritura) {
      motivos.push("natural_missing_poder_data");
    }
  }

  // (2d) Regla B — "juridica" sin esqueleto mínimo de constitución.
  if (tipoIA === "juridica") {
    const c = apo.sociedad_constitucion || {};
    const tieneAlgunDatoConstitucion =
      isNonEmpty(c.numero) ||
      isNonEmpty(c.fecha) ||
      isNonEmpty(c.fecha_texto) ||
      isNonEmpty(c.camara_comercio_ciudad) ||
      isNonEmpty(c.camara_comercio_numero);
    if (
      !isNonEmpty(apo.sociedad_razon_social) ||
      !isNonEmpty(apo.sociedad_nit) ||
      !tieneAlgunDatoConstitucion
    ) {
      motivos.push("juridica_missing_constitution_data");
    }
  }

  if (motivos.length > 0) {
    return { tipoEfectivo: null, motivos, fromOverride: false };
  }
  return { tipoEfectivo: tipoIA, motivos: [], fromOverride: false };
}

/** Etiquetas humano-legibles para motivos de degradación. */
export const MOTIVO_LABELS: Record<string, string> = {
  corporate_keywords_in_natural_classification:
    "Se detectaron palabras corporativas ('S.A.S.', 'Representante Legal', etc.) en el nombre o cargo del apoderado natural. Confirma si es persona natural o jurídica.",
  juridica_missing_constitution_data:
    "Faltan datos de constitución de la sociedad apoderada (NIT, razón social o Cámara de Comercio). Complétalos o marca el tipo manualmente.",
  natural_missing_poder_data:
    "Faltan datos de la escritura del poder (número, fecha o notaría). Complétalos para continuar.",
  low_confidence_from_ocr:
    "La IA tuvo baja confianza al clasificar el tipo de apoderado. Confirma manualmente.",
  no_apoderado_tipo_from_ocr:
    "La IA no logró determinar el tipo de apoderado. Selecciona manualmente natural o jurídica.",
};
