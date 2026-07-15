// ============================================================================
// overrideSchema — Zod compartido (cliente + edge).
// Bloquea tokens prohibidos e intentos de redefinir marcadores canónicos.
// ISOMÓRFICO: usa exclusivamente `zod`, disponible en Vite y Deno (npm:zod).
// ============================================================================

import { z, ZodError } from "zod";
import type { ProsaApoderadoOverride } from "./types.ts";

/** Tokens sucios que no deben persistirse dentro de notas del usuario. */
export const FORBIDDEN_NOTE_TOKENS = [
  "___________",
  "undefined",
  "null",
  "N/A",
  "n/a",
  "ilegible",
  "ILEGIBLE",
] as const;

/**
 * Marcadores canónicos INTOCABLES. Si aparecen en las notas del usuario
 * significan que está intentando reescribir el núcleo — bloqueado.
 */
export const FORBIDDEN_CANONICAL_MARKERS = [
  "COMPARECIÓ:",
  "PRIMERO.-",
  "SEGUNDO.-",
  "NIT: 860.034.313-7",
  "AUTORIZA que el presente instrumento",
  "BANCO DAVIVIENDA S.A.",
] as const;

export function isOverrideForbidden(text: string): { ok: boolean; reason?: string } {
  const s = text ?? "";
  for (const token of FORBIDDEN_NOTE_TOKENS) {
    if (s.includes(token)) return { ok: false, reason: `Contiene token prohibido: "${token}"` };
  }
  for (const marker of FORBIDDEN_CANONICAL_MARKERS) {
    if (s.includes(marker)) {
      return {
        ok: false,
        reason: `No se pueden redefinir marcadores canónicos: "${marker}"`,
      };
    }
  }
  return { ok: true };
}

const NotasSchema = z
  .string()
  .max(2000, "Máximo 2000 caracteres en notas adicionales.")
  .refine((s) => {
    const r = isOverrideForbidden(s);
    return r.ok;
  }, (s) => ({ message: isOverrideForbidden(s).reason ?? "Nota inválida." }))
  .nullable()
  .optional();

const CamposSchema = z
  .object({
    sociedad_constitucion: z
      .object({
        reforma_acta_numero: z.string().max(80).nullable().optional(),
        razon_social_anterior: z.string().max(240).nullable().optional(),
      })
      .partial()
      .nullable()
      .optional(),
    representante_legal_cargo: z.string().max(160).nullable().optional(),
    representante_legal_cedula_expedida_en: z.string().max(120).nullable().optional(),
  })
  .partial()
  .nullable()
  .optional();

export const OverrideSchema = z
  .object({
    notas_adicionales: NotasSchema,
    campos_editados: CamposSchema,
    fuente_referencia: z.enum(["estilo", "datos", "manual"]).nullable().optional(),
    actualizado_en: z.string().nullable().optional(),
  })
  .strict();

/**
 * Sanitiza un override — devuelve el resultado parseado o lanza ZodError.
 * Los consumidores (cliente antes de update, edge antes de merge, edge
 * `adaptar-estilo-prosa` antes de responder) DEBEN usar esta función.
 */
export function sanitizeOverride(input: unknown): ProsaApoderadoOverride {
  return OverrideSchema.parse(input) as ProsaApoderadoOverride;
}

// ---------------------------------------------------------------------------
// Clasificador de errores del schema — la UI decide cómo reaccionar según la
// causa (ofrecer redirigir el texto a `adaptar-estilo-prosa` cuando fue un
// marcador canónico, vs. toast normal en los demás casos).
// ---------------------------------------------------------------------------

export type OverrideErrorKind =
  | "canonical_marker"
  | "forbidden_token"
  | "too_long"
  | "other";

export interface OverrideErrorInfo {
  kind: OverrideErrorKind;
  message: string;
  path: (string | number)[];
}

export function classifyOverrideError(err: unknown): OverrideErrorInfo | null {
  if (!(err instanceof ZodError)) return null;
  const issue = err.issues[0];
  if (!issue) return null;
  const msg = issue.message ?? "";
  let kind: OverrideErrorKind = "other";
  if (msg.startsWith("No se pueden redefinir marcadores canónicos")) kind = "canonical_marker";
  else if (msg.startsWith("Contiene token prohibido")) kind = "forbidden_token";
  else if (msg.startsWith("Máximo 2000 caracteres")) kind = "too_long";
  return { kind, message: msg, path: [...issue.path] };
}
