// Versionado del schema y prompt del OCR de Poder General del Banco.
// Cambiar estas constantes INVALIDA las entradas previas en `ocr_raw_cache`,
// forzando una nueva extracción con la versión actualizada.
//
// Convención: bump major cuando se rompe compatibilidad de campos.
export const POWER_PROMPT_VERSION = "v5-2026-06-30";
export const POWER_SCHEMA_VERSION = "poder_banco_v5";
export const POWER_GEMINI_MODEL = "google/gemini-2.5-flash";

// Feature flag para rollout progresivo del pipeline v5 (lectura profunda +
// caché + validador determinista). Cuando esté en `false`, el flujo continúa
// con el schema plano legacy. Cambiar a `true` cuando la UI esté lista.
export const POWER_V5_ENABLED = (Deno.env.get("POWER_V5_ENABLED") ?? "false") === "true";
