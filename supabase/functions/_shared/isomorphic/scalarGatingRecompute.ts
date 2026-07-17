// ============================================================================
// scalarGatingRecompute — recálculo efímero de coherencia escalar en el
// choke point de generación (`generateAndUploadCancelacionDocs`).
//
// Problema que resuelve: `_coherencia_warnings` se persiste UNA sola vez
// (durante `live_pipeline` o `reprocess_poder`) y luego NO se recalcula. Si
// el humano edita en la UI un campo escalar (ej. `apoderado_escritura`,
// `poderdante.entidad_nit`, `apoderado_cedula`) para resolver una
// incoherencia, el snapshot persistido queda obsoleto y sigue bloqueando
// generación para siempre. Este helper re-evalúa los códigos escalares
// contra los datos actuales del payload sin persistir nada. La UI sigue
// mostrando el snapshot viejo hasta la próxima extracción OCR real.
//
// 🛡️ PUREZA: solo TS, isomórfico (edge + client). Sin fetch, sin Deno.
// ============================================================================

import { validatePoderBancoCoherencia } from "./poderBancoExtractor/validate.ts";
import { validatePoderVsCancelacion } from "./poderBancoExtractor/validateIntraTramite.ts";

/**
 * Códigos hard-block que se re-evalúan en el choke point de generación
 * contra los datos EDITADOS (data.poder_banco + data.partes), no contra
 * el `_coherencia_warnings` persistido. Si el recálculo fresco ya no los
 * emite tras la edición humana, dejan de contar como motivo de bloqueo.
 * Cero persistencia — la UI sigue viendo el array viejo hasta la próxima
 * extracción real.
 *
 * NO agregar aquí un código sin también:
 *   (a) confirmar que `validatePoderBancoCoherencia` o
 *       `validatePoderVsCancelacion` lo emiten sobre el shape de
 *       `data.poder_banco`/`data.partes` sin transformación, y
 *   (b) confirmar que el humano puede corregir al menos UN campo que
 *       influya en la re-evaluación (contra la UI real, no la intención).
 */
export const SCALAR_COHERENCE_GATING_CODES = [
  "escritura_num_incoherente",
  "fecha_incoherente",
  "poder_entidad_nit_incoherente",
  "poder_entidad_nombre_incoherente",
  "apoderado_cedula_no_legible",
  "escritura_poder_no_legible",
  "fecha_poder_no_legible",
] as const;

export type ScalarGatingCode = (typeof SCALAR_COHERENCE_GATING_CODES)[number];

export interface ScalarGatingInput {
  poder_banco?: unknown;
  partes?: { banco_nit?: string | null; banco_acreedor?: string | null } | null;
}

/**
 * Recálculo efímero de coherencia escalar sobre datos EDITADOS. Devuelve
 * el set de códigos en `SCALAR_COHERENCE_GATING_CODES` que SIGUEN vigentes
 * tras leer los valores actuales. No persiste nada. Puro.
 */
export function recomputeScalarCoherenceForGating(
  data: ScalarGatingInput,
): Set<string> {
  const pb = (data?.poder_banco ?? {}) as Record<string, unknown>;
  const partes = {
    banco_nit: data?.partes?.banco_nit ?? null,
    banco_acreedor: data?.partes?.banco_acreedor ?? null,
  };
  const a = validatePoderBancoCoherencia(pb).warnings;
  const b = validatePoderVsCancelacion(pb, partes).warnings;
  const fresh = new Set<string>([...a, ...b]);
  return new Set(SCALAR_COHERENCE_GATING_CODES.filter((c) => fresh.has(c)));
}

/**
 * Filtra la lista de `motivos` removiendo aquellos códigos gating que YA
 * no se emiten frescos tras la edición humana. Solo actúa sobre códigos
 * enumerados en `SCALAR_COHERENCE_GATING_CODES`: cualquier otro motivo
 * (menciones, placeholder, duplicidad cruzada, warnings no gating) pasa
 * intacto. Cero side-effects sobre `data`.
 */
export function filterMotivosByScalarRecompute(
  motivos: string[],
  data: ScalarGatingInput,
): string[] {
  const stillFresh = recomputeScalarCoherenceForGating(data);
  const gatingSet = new Set<string>(SCALAR_COHERENCE_GATING_CODES);
  return motivos.filter((m) => !gatingSet.has(m) || stillFresh.has(m));
}
