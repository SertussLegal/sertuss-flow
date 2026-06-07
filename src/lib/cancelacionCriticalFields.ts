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
