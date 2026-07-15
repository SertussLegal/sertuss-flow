// ============================================================================
// prosaBancos/index — Registry central por NIT (ISOMÓRFICO).
// ============================================================================

import { daviviendaTemplate } from "./davivienda.ts";
import type { ProsaBancoTemplate } from "./types.ts";

export type {
  ProsaBancoTemplate,
  ProsaContext,
  ProsaApoderadoOverride,
  PoderdantePayload,
  InstrumentoPoderPayload,
  ApoderadoPayload,
  TipoApoderado,
} from "./types.ts";
export { daviviendaTemplate } from "./davivienda.ts";
export { mergeOverride } from "./mergeOverride.ts";
export {
  OverrideSchema,
  sanitizeOverride,
  isOverrideForbidden,
  classifyOverrideError,
  FORBIDDEN_NOTE_TOKENS,
  FORBIDDEN_CANONICAL_MARKERS,
} from "./overrideSchema.ts";
export type { OverrideErrorKind, OverrideErrorInfo } from "./overrideSchema.ts";

const TEMPLATES: ProsaBancoTemplate[] = [daviviendaTemplate];

function normalizeNit(nit: string): string {
  return nit.replace(/[.\s\-]/g, "");
}

const REGISTRY: Record<string, ProsaBancoTemplate> = (() => {
  const map: Record<string, ProsaBancoTemplate> = {};
  for (const t of TEMPLATES) {
    map[t.nitBanco] = t;
    map[normalizeNit(t.nitBanco)] = t;
    for (const a of t.nitAliases) {
      map[a] = t;
      map[normalizeNit(a)] = t;
    }
  }
  return map;
})();

export function getProsaBanco(nit: string | null | undefined): ProsaBancoTemplate | null {
  if (!nit) return null;
  const clean = nit.trim();
  if (clean in REGISTRY) return REGISTRY[clean];
  const norm = normalizeNit(clean);
  if (norm in REGISTRY) return REGISTRY[norm];
  const nine = norm.slice(0, 9);
  if (nine.length === 9 && nine in REGISTRY) return REGISTRY[nine];
  for (const key of Object.keys(REGISTRY)) {
    if (normalizeNit(key).startsWith(nine) && nine.length === 9) return REGISTRY[key];
  }
  return null;
}

export function listBancosSoportados(): string[] {
  return TEMPLATES.map((t) => `${t.nitBanco} (${t.nombreBanco})`);
}
