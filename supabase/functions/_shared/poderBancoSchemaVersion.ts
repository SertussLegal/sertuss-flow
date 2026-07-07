// ============================================================================
// Versionado del schema y prompt del OCR de Poder General del Banco.
// Cambiar POWER_PROMPT_VERSION / POWER_SCHEMA_VERSION INVALIDA las entradas
// previas en `ocr_raw_cache`, forzando una nueva extracción con la versión
// actualizada.
// ============================================================================

export const POWER_PROMPT_VERSION = "v6-2026-07-03";
export const POWER_SCHEMA_VERSION = "poder_banco_v6";
export const POWER_GEMINI_MODEL = "google/gemini-2.5-flash";

// ============================================================================
// MATRIZ DE FEATURE FLAGS DEL PODER GENERAL (P5 — higiene de nombres)
// ----------------------------------------------------------------------------
//  Flag (nombre nuevo)                | Ámbito | Controla
//  -----------------------------------+--------+---------------------------------
//  POWER_DEEP_SCHEMA_ENABLED          | edge   | Pipeline profundo v5 en
//   (alias legacy: POWER_V5_ENABLED)  |        | procesar-cancelacion: caché
//                                     |        | inmutable + validador determinista
//                                     |        | + selectMinutaTemplate(v3 vs v2).
//  -----------------------------------+--------+---------------------------------
//  POWER_V6_EXTRACTOR_ENABLED         | edge   | Reemplaza extractor plano legacy
//                                     |        | por el módulo isomórfico
//                                     |        | `_shared/isomorphic/poderBancoExtractor`
//                                     |        | y puebla data_ia.poder_banco.apoderado.tipo.
//  -----------------------------------+--------+---------------------------------
//  VITE_POWER_DEEP_UI_ENABLED         | client | Muestra la UI profunda de Poder
//   (alias legacy: VITE_POWER_V5_     |        | en CancelacionValidar / PoderViewerTab.
//    ENABLED)                         |        |
//  -----------------------------------+--------+---------------------------------
//  (cache) — implícito, siempre ON    | edge   | ocr_raw_cache: la caché siempre
//   dentro del pipeline v5.           |        | corre cuando POWER_DEEP_SCHEMA_ENABLED
//                                     |        | está activo (no tiene flag propio).
// ============================================================================

/**
 * Lee un booleano de Deno.env aceptando un nombre nuevo y un alias legacy
 * (transición de 30 días). Cualquiera de los dos con `"true"` gana.
 */
function readBoolEnv(newName: string, legacyName: string, defaultVal: boolean): boolean {
  const raw = Deno.env.get(newName) ?? Deno.env.get(legacyName);
  if (raw == null) return defaultVal;
  return raw === "true";
}

/** Pipeline profundo v5 (caché + validador). Default: OFF. */
export const POWER_DEEP_SCHEMA_ENABLED = readBoolEnv(
  "POWER_DEEP_SCHEMA_ENABLED",
  "POWER_V5_ENABLED",
  false,
);

/** Alias legacy — mantener 30 días para no romper importadores existentes. */
export const POWER_V5_ENABLED = POWER_DEEP_SCHEMA_ENABLED;

/**
 * Extractor v6 (schema profundo isomórfico) en procesar-cancelacion.
 * Ortogonal a POWER_DEEP_SCHEMA_ENABLED. Default: OFF (cero regresión).
 */
export const POWER_V6_EXTRACTOR_ENABLED =
  (Deno.env.get("POWER_V6_EXTRACTOR_ENABLED") ?? "false") === "true";
