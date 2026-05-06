// Shared rules + sanitizer for AI outputs (Gemini & Claude).
//
// Goal: prevent characters that break docxRunNormalizer or the Word XML,
// and avoid the cross-paragraph-skipped error caused by stray newlines
// inside paragraphs.
//
// Two layers of defense:
//  1) STRICT_OUTPUT_RULES — text appended to system prompts.
//  2) sanitizeAiOutput()  — defensive post-processing in case the model
//     ignores the rules.

export const STRICT_OUTPUT_RULES = `

REGLAS DE INTEGRIDAD DE SALIDA (OBLIGATORIAS — NO NEGOCIABLES):

1. CARACTERES PROHIBIDOS (rompen el XML del .docx):
   - NUNCA emitas: "{", "}", "«", "»", "<<", ">>".
   - Para placeholders/espacios en blanco usa EXCLUSIVAMENTE once underscores: "___________" (11 caracteres "_").
   - NO uses corchetes "[ ]" como placeholders. NO uses puntos suspensivos "..." como placeholders.

2. SANITIZACIÓN DE TEXTO:
   - Salida exclusivamente en ASCII imprimible + acentos españoles (áéíóúñÁÉÍÓÚÑüÜ¿¡).
   - PROHIBIDOS los caracteres invisibles: zero-width space (U+200B), BOM (U+FEFF), tabulaciones, caracteres de control.
   - Usa comillas tipográficas estándar ("..." o '...'). NO uses comillas angulares «».

3. ESTRUCTURA DE PÁRRAFOS:
   - Cada cláusula legal debe ser UN ÚNICO bloque continuo de texto.
   - Usa "\\n\\n" SOLO para separar cláusulas completas distintas.
   - PROHIBIDO insertar "\\n" arbitrarios DENTRO de un párrafo o cláusula (esto fragmenta los tags Word).
   - NO partas frases con saltos de línea: una oración debe ir en una sola línea lógica.

Estas reglas son críticas: la salida se inserta en una plantilla .docx procesada por docxtemplater. Cualquier carácter prohibido o salto de línea espurio rompe la generación del documento.`;

const ZWSP_BOM_CTRL = /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

/**
 * Defensive post-processing for any AI-generated text field.
 * Safe to call multiple times. Preserves \n\n paragraph separators.
 */
export function sanitizeAiOutput(text: string): string {
  if (!text || typeof text !== "string") return text;

  let out = text;

  // 1) Strip invisibles & control chars (keep \n, \r, \t handled below)
  out = out.replace(ZWSP_BOM_CTRL, "");

  // 2) Normalize CRLF to LF, drop tabs (replace by single space)
  out = out.replace(/\r\n?/g, "\n").replace(/\t/g, " ");

  // 3) Replace forbidden characters that would break Word XML / docxtemplater
  out = out
    .replace(/[«»]/g, '"')
    .replace(/<<+/g, '"')
    .replace(/>>+/g, '"');

  // 4) Curly braces: only allowed if part of an actual underscore placeholder.
  //    Strip stray { } that the model emitted by mistake.
  out = out.replace(/[{}]/g, "");

  // 5) Collapse 3+ consecutive newlines to a paragraph break (\n\n).
  //    Then collapse a single \n inside a paragraph to a space (cross-paragraph fix),
  //    while preserving \n\n boundaries between paragraphs.
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/([^\n])\n([^\n])/g, "$1 $2");

  // 6) Whitespace tidy
  out = out
    .replace(/[ \u00A0]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n +/g, "\n")
    .replace(/\s+([,.;:])/g, "$1");

  return out.trim();
}

// ============================================================
// Fase 3 — UI Contract enforcement
// ============================================================
// Server-side guarantees that every Claude validation has a valid
// `ui_target` + `priority` and that text fields fit the side panel.
// The UI never sees malformed payloads even if the model misbehaves.

export const MAX_EXPLICACION = 220;
export const MAX_VALOR_SUGERIDO = 80;

const VALID_UI_TARGETS = new Set([
  "modal_bloqueante",
  "side_panel_audit",
  "field_inline_badge",
]);
const VALID_PRIORITIES = new Set(["high", "medium", "low"]);

function truncate(value: unknown, max: number): { value: string; truncated: boolean } {
  if (typeof value !== "string") return { value: value == null ? "" : String(value), truncated: false };
  if (value.length <= max) return { value, truncated: false };
  return { value: value.slice(0, max - 1).trimEnd() + "…", truncated: true };
}

function priorityFromNivel(nivel: unknown): "high" | "medium" | "low" {
  if (nivel === "error") return "high";
  if (nivel === "advertencia") return "medium";
  return "low";
}

export interface UiContractStats {
  truncations: number;
  ui_targets: { modal_bloqueante: number; side_panel_audit: number; field_inline_badge: number };
  priorities: { high: number; medium: number; low: number };
}

/**
 * Enforce the UI contract for an array of Claude validations.
 * - Truncates `explicacion` and `valor_sugerido` to safe lengths.
 * - Defaults `ui_target` to `side_panel_audit` if missing or invalid.
 * - Defaults `priority` based on `nivel` if missing or invalid.
 */
export function enforceUiContract(
  validaciones: any[],
): { validaciones: any[]; stats: UiContractStats } {
  const stats: UiContractStats = {
    truncations: 0,
    ui_targets: { modal_bloqueante: 0, side_panel_audit: 0, field_inline_badge: 0 },
    priorities: { high: 0, medium: 0, low: 0 },
  };

  if (!Array.isArray(validaciones)) return { validaciones: [], stats };

  const out = validaciones.map((v) => {
    if (!v || typeof v !== "object") return v;

    const explic = truncate(v.explicacion, MAX_EXPLICACION);
    const sugerido = truncate(v.valor_sugerido, MAX_VALOR_SUGERIDO);
    if (explic.truncated) stats.truncations += 1;
    if (sugerido.truncated) stats.truncations += 1;

    const ui_target = VALID_UI_TARGETS.has(v.ui_target) ? v.ui_target : "side_panel_audit";
    const priority = VALID_PRIORITIES.has(v.priority) ? v.priority : priorityFromNivel(v.nivel);

    stats.ui_targets[ui_target as keyof typeof stats.ui_targets] += 1;
    stats.priorities[priority as keyof typeof stats.priorities] += 1;

    return {
      ...v,
      explicacion: explic.value,
      valor_sugerido: v.valor_sugerido != null ? sugerido.value : v.valor_sugerido,
      ui_target,
      priority,
    };
  });

  return { validaciones: out, stats };
}

/**
 * Recursively sanitize every string field of a JSON-like object.
 * Useful for Claude's structured response (validaciones[].explicacion etc.).
 */
export function sanitizeAiJson<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeAiOutput(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeAiJson(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeAiJson(v);
    }
    return out as unknown as T;
  }
  return value;
}
