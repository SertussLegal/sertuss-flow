// ============================================================================
// apoderadoClassifier — espejo cliente del módulo en
// `supabase/functions/_shared/apoderadoClassifier.ts`.
//
// Mantener SINCRONIZADO byte-a-byte con el archivo Deno. No importa nada
// específico de browser ni de Deno para poder ser reutilizado en ambos
// runtimes sin cambios. Cualquier ajuste debe replicarse en ambos lados.
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
  tipo_override?: TipoApoderado | string;
  escritura_poder_num?: string | null;
  escritura_poder_fecha?: string | null;
  escritura_poder_notaria_num?: string | null;
  _confianza_tipo?: "alta" | "media" | "baja" | null;
}

export interface ClassifierResult {
  tipoEfectivo: TipoApoderado;
  motivos: string[];
  fromOverride: boolean;
}

const CORPORATE_PATTERNS: RegExp[] = [
  /\bS\.?\s*A\.?\s*S\.?\b/i,
  /\bS\.?\s*A\.?\b(?!\s*S)/i,
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

export function classifyApoderado(apo: ApoderadoPayload | null | undefined): ClassifierResult {
  if (!apo) {
    return { tipoEfectivo: null, motivos: ["no_apoderado_tipo_from_ocr"], fromOverride: false };
  }

  const override = apo.tipo_override;
  if (override === "natural" || override === "juridica") {
    return { tipoEfectivo: override, motivos: [], fromOverride: true };
  }

  const tipoIA = apo.tipo === "natural" || apo.tipo === "juridica" ? apo.tipo : null;
  const motivos: string[] = [];

  if (apo._confianza_tipo === "baja") {
    motivos.push("low_confidence_from_ocr");
  }

  if (!tipoIA) {
    if (motivos.length === 0) motivos.push("no_apoderado_tipo_from_ocr");
    return { tipoEfectivo: null, motivos, fromOverride: false };
  }

  if (tipoIA === "natural") {
    if (hasCorporateContamination([apo.nombre, apo.cargo])) {
      motivos.push("corporate_keywords_in_natural_classification");
    }
    const faltaEscritura =
      !isNonEmpty(apo.escritura_poder_num) ||
      !isNonEmpty(apo.escritura_poder_fecha) ||
      !isNonEmpty(apo.escritura_poder_notaria_num);
    if (faltaEscritura) {
      motivos.push("natural_missing_poder_data");
    }
  }

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
