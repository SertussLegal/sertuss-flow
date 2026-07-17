// Fuente única de verdad para (a) los sufijos hard-block y (b) las reglas
// de excepción "Manual > OCR > BD" que suprimen warnings cuando el humano
// confirma la revisión manual y el escalar relacionado quedó válido.
//
// Movido desde `procesar-cancelacion/index.ts` sin cambios de comportamiento:
// mismo shape, mismos predicados, misma semántica. Se re-exporta también
// `HARD_BLOCK_WARNING_SUFFIXES` desde este módulo para que auditorías de
// código estático puedan importar ambas listas desde un único punto.

import { isCedulaValida, normalizeCedula, PODER_CEDULAS_PLACEHOLDER } from "./validate.ts";
export { HARD_BLOCK_WARNING_SUFFIXES } from "./validate.ts";

// ── Predicados locales (idénticos a los de index.ts) ────────────────────

function sanitizeMatriculaLocal(raw?: unknown): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const clean = String(raw)
    .replace(/[()]/g, " ")
    .replace(/\bDOSCIENTOS\b|\bMIL\b|\bCINCUENTA\b|\bCIENTO\b|\bCUARENTA\b|\bSESENTA\b|\bSETENTA\b|\bOCHENTA\b|\bNOVENTA\b|\bTREINTA\b|\bVEINTE\b|\bDIEZ\b|\bUNO\b|\bDOS\b|\bTRES\b|\bCUATRO\b|\bCINCO\b|\bSEIS\b|\bSIETE\b|\bOCHO\b|\bNUEVE\b|\bQUINIENTOS\b|\bSEISCIENTOS\b|\bSETECIENTOS\b|\bOCHOCIENTOS\b|\bNOVECIENTOS\b|\bCUATROCIENTOS\b|\bTRESCIENTOS\b|\bMILLON(?:ES)?\b/gi, " ")
    .replace(/[^0-9A-Za-z-]/g, "")
    .toUpperCase();
  const m = clean.match(/(\d{1,4}[A-Z]?)-?(\d{3,})/);
  if (!m) return clean || undefined;
  return `${m[1]}-${m[2]}`;
}

function isCedulaEditadaValida(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "" && isCedulaValida(v);
}

/** Predicado más estricto que `isCedulaEditadaValida`: además del formato,
 *  exige que la cédula normalizada NO esté en el catálogo de placeholders
 *  conocidos (`PODER_CEDULAS_PLACEHOLDER`). Sin esto, un notario podría
 *  "confirmar revisión manual" dejando la misma cédula placeholder (ej.
 *  79.123.456, que pasa el regex de 6-10 dígitos) y desbloquear una
 *  alucinación documentada del OCR. */
function isCedulaEditadaValidaNoPlaceholder(v: unknown): boolean {
  if (!isCedulaEditadaValida(v)) return false;
  const norm = normalizeCedula(v as string);
  return !!norm && !PODER_CEDULAS_PLACEHOLDER.has(norm);
}

function isMatriculaValida(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = sanitizeMatriculaLocal(v);
  return !!s && /^\d{1,4}[A-Z]?-\d{3,}$/.test(s);
}

function isDireccionEditadaValida(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s.length >= 8 && s !== "NO_LEGIBLE" && !/^_+$/.test(s);
}

// ── Reglas de excepción Manual > OCR > BD ───────────────────────────────

export type ManualOverrideRule<D = Record<string, unknown>> = {
  warning: string;
  canSuppress: (d: D) => boolean;
};

export const MANUAL_OVERRIDE_RULES: ManualOverrideRule[] = [
  {
    warning: "rl_banco_menciones_incoherentes",
    canSuppress: (d) => {
      const pb = ((d as Record<string, unknown>).poder_banco || {}) as Record<string, unknown>;
      const poderdante = (pb.poderdante || {}) as Record<string, unknown>;
      return isCedulaEditadaValida(poderdante.representante_legal_cedula);
    },
  },
  {
    warning: "apoderado_cedula_menciones_incoherentes",
    canSuppress: (d) => {
      const pb = ((d as Record<string, unknown>).poder_banco || {}) as Record<string, unknown>;
      const apo = (pb.apoderado || {}) as Record<string, unknown>;
      // Ambos escalares (plano + detalle) deben ser válidos: si sólo uno lo es,
      // la incoherencia persiste DENTRO del propio data_final editado.
      return isCedulaEditadaValida(pb.apoderado_cedula)
          && isCedulaEditadaValida(apo.cedula);
    },
  },
  {
    warning: "inmueble_matricula_menciones_incoherentes",
    canSuppress: (d) => {
      const im = ((d as Record<string, unknown>).inmueble || {}) as Record<string, unknown>;
      return isMatriculaValida(im.matricula_inmobiliaria);
    },
  },
  {
    warning: "inmueble_direccion_menciones_incoherentes",
    canSuppress: (d) => {
      const im = ((d as Record<string, unknown>).inmueble || {}) as Record<string, unknown>;
      return isDireccionEditadaValida(im.nomenclatura_predio);
    },
  },
];

export function applyManualOverrideExceptions<D>(
  motivos: string[],
  data: D,
): string[] {
  return motivos.filter((m) => {
    const rule = MANUAL_OVERRIDE_RULES.find((r) => r.warning === m);
    if (!rule) return true;              // warning no cubierto → sigue bloqueando
    return !(rule.canSuppress as (d: unknown) => boolean)(data); // escalar válido → filtra el motivo
  });
}
