// ============================================================================
// Desempate determinista de cuantía — hace cumplir POR CÓDIGO la regla de
// desambiguación que hoy solo vive en prosa dentro del prompt (PASO 3, caso c).
//
// Isomórfico: fuente única de verdad. El edge function `procesar-cancelacion`
// y los tests del frontend importan desde aquí.
// ============================================================================

export interface CuantiaCandidatoLike {
  clasificacion?: string;
  monto?: number | null;
  texto_fragmento?: string;
  pagina_aprox?: number | null;
}

/** Warning hard-block emitido cuando hay conflicto irresoluble de cuantía.
 *  Sufijo `_no_resuelto` → registrado en HARD_BLOCK_WARNING_SUFFIXES. */
export const CUANTIA_CONFLICTO_WARNING = "cuantia_conflicto_candidatos_no_resuelto";

/** Motivo de origen que se estampa en `hipoteca_anterior.cuantia_origen`
 *  cuando el conflicto fuerza la cuantía a indeterminada. Distinto de los
 *  motivos del modelo (`ambigua_multiple` / `escritura_declara_abierta` /
 *  `sin_evidencia`) para poder diferenciarlo en telemetría. */
export const CUANTIA_CONFLICTO_ORIGEN = "conflicto_candidatos_no_resuelto";

/**
 * Hace cumplir por código la regla de desambiguación que hoy solo vive en
 * prosa dentro del prompt (PASO 3): si hay 2+ candidatos clasificados
 * cuantia_credito con montos numéricamente DISTINTOS (ignorando null/0),
 * es un conflicto real — nunca se debe confiar en cuál escogió el modelo,
 * se fuerza indeterminada + revisión manual. Si son 0, 1, o varios con el
 * MISMO monto, no cambia nada (comportamiento actual intacto).
 * Validado contra 26 trámites históricos 2026-08-01: atrapa el único caso
 * real de conflicto (982af289, $31.113.670 vs $7.968.114 — el modelo había
 * elegido el incorrecto con confianza "alta") y no genera falsos positivos
 * en los otros 10 trámites con múltiples candidatos de mismo monto.
 */
export function detectarConflictoCuantia(
  candidatos: CuantiaCandidatoLike[] | undefined | null,
): { conflicto: boolean; montosDistintos: number[] } {
  const montos = new Set<number>();
  for (const c of candidatos ?? []) {
    if (!c || c.clasificacion !== "cuantia_credito") continue;
    if (c.monto == null || c.monto === 0) continue;
    if (typeof c.monto !== "number" || !Number.isFinite(c.monto)) continue;
    montos.add(c.monto);
  }
  return { conflicto: montos.size >= 2, montosDistintos: [...montos] };
}
