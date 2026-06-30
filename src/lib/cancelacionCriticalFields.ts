/**
 * cancelacionCriticalFields — Catálogo mínimo obligatorio para generar
 * una cancelación de hipoteca (flujo Davivienda v2).
 *
 * Estos campos NO bloquean el flujo, pero deben marcarse visualmente en
 * rojo cuando estén vacíos para que el abogado los complete antes de
 * descargar el `.docx` final.
 *
 * Mantener sincronizado con la sección "Hipoteca anterior", "Inmueble"
 * y "Partes" del formulario en `CancelacionValidar.tsx`.
 */

export interface CancelacionCriticalDescriptor {
  /** Path con notación de puntos sobre el objeto `Data` de cancelación. */
  path: string;
  /** Etiqueta legible. */
  label: string;
}

export const CANCELACION_CRITICAL_FIELDS: CancelacionCriticalDescriptor[] = [
  { path: "hipoteca_anterior.numero_escritura_hipoteca", label: "Número de escritura de hipoteca" },
  { path: "hipoteca_anterior.fecha_escritura_hipoteca", label: "Fecha de escritura de hipoteca" },
  { path: "hipoteca_anterior.valor_hipoteca_original", label: "Valor del crédito hipotecario" },
  { path: "inmueble.matricula_inmobiliaria", label: "Matrícula inmobiliaria" },
  { path: "partes.deudor_nombre", label: "Nombre del deudor" },
  { path: "partes.deudor_identificacion", label: "Identificación del deudor" },
  { path: "partes.banco_nit", label: "NIT del banco" },
];

/**
 * Campos críticos del bloque "Poder General del Banco". Solo aplican cuando
 * el usuario adjuntó el poder (`poder_adjuntado === true`); si el banco firma
 * directo, deben quedar fuera del cómputo de campos faltantes.
 *
 * Plan v5/B2: se invocan exclusivamente desde el contexto donde se conoce
 * el flag `poder_adjuntado` del trámite.
 */
const PODER_CRITICAL_FIELDS: CancelacionCriticalDescriptor[] = [
  { path: "poder_banco.apoderado_nombre", label: "Nombre del apoderado del banco" },
  { path: "poder_banco.apoderado_cedula", label: "Cédula del apoderado del banco" },
  { path: "poder_banco.apoderado_escritura", label: "Escritura del Poder General" },
  { path: "poder_banco.apoderado_fecha", label: "Fecha del Poder General" },
  { path: "poder_banco.apoderado_notaria_poder", label: "Notaría del Poder General" },
];

/**
 * Devuelve la lista efectiva de campos críticos según si el usuario adjuntó
 * el Poder General del Banco. Mantener separado de la constante estática
 * `CANCELACION_CRITICAL_FIELDS` evita romper consumidores legacy.
 */
export function getCancelacionCriticalFields(opts: {
  poderAdjuntado: boolean;
}): CancelacionCriticalDescriptor[] {
  return opts.poderAdjuntado
    ? [...CANCELACION_CRITICAL_FIELDS, ...PODER_CRITICAL_FIELDS]
    : CANCELACION_CRITICAL_FIELDS;
}

const PLACEHOLDER = "___________";

export function isCancelacionFieldEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const t = value.trim();
    return !t || t === PLACEHOLDER;
  }
  return false;
}

/** Lee una ruta dotted (sin arrays). */
export function readCancelacionPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = data;
  for (const p of parts) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}
