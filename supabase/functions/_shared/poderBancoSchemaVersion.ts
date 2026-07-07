// Versionado del schema y prompt del OCR de Poder General del Banco.
// Cambiar estas constantes INVALIDA las entradas previas en `ocr_raw_cache`,
// forzando una nueva extracción con la versión actualizada.
//
// Convención: bump major cuando se rompe compatibilidad de campos.
export const POWER_PROMPT_VERSION = "v6-2026-07-03";
export const POWER_SCHEMA_VERSION = "poder_banco_v6";
export const POWER_GEMINI_MODEL = "google/gemini-2.5-flash";

// Feature flag para rollout progresivo del pipeline v5 (lectura profunda +
// caché + validador determinista). Cuando esté en `false`, el flujo continúa
// con el schema plano legacy. Cambiar a `true` cuando la UI esté lista.
export const POWER_V5_ENABLED = (Deno.env.get("POWER_V5_ENABLED") ?? "false") === "true";

// Feature flag ORTOGONAL: activa el extractor v6 (schema profundo) dentro de
// `procesar-cancelacion`. Cuando está en `false` (default), el extractor
// sigue siendo el plano legacy `extract_poder_banco_dedicado` — cero
// regresión. Cuando está en `true`, se usa el schema completo del módulo
// isomórfico `_shared/isomorphic/poderBancoExtractor` y se puebla
// `data_ia.poder_banco.apoderado.tipo` para habilitar la plantilla v3.
export const POWER_V6_EXTRACTOR_ENABLED =
  (Deno.env.get("POWER_V6_EXTRACTOR_ENABLED") ?? "false") === "true";
