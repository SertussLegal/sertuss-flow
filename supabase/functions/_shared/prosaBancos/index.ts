// ============================================================================
// prosaBancos/index — Registry central por NIT.
//
// Añadir un banco nuevo:
//   1. Crear `./nuevo_banco.ts` implementando ProsaBancoTemplate.
//   2. Registrar en REGISTRY con su NIT canónico + aliases.
//   3. Los tests de snapshot correspondientes en __tests__/.
//
// El motor `procesar-cancelacion` llama `getProsaBanco(nit)` y delega;
// no conoce prosa hardcodeada.
// ============================================================================

import { daviviendaTemplate } from "./davivienda.ts";
import type { ProsaBancoTemplate } from "./types.ts";

export type { ProsaBancoTemplate, ProsaContext, PoderdantePayload, InstrumentoPoderPayload } from "./types.ts";

const TEMPLATES: ProsaBancoTemplate[] = [daviviendaTemplate];

/** Normaliza un NIT a solo dígitos (sin puntos, sin DV) para lookup. */
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

/**
 * Resuelve el template de prosa para un banco por NIT.
 * Devuelve `null` si el banco no tiene template registrado — el caller decide
 * si bloquea (v3) o si cae al flujo legacy v2.
 */
export function getProsaBanco(nit: string | null | undefined): ProsaBancoTemplate | null {
  if (!nit) return null;
  const clean = nit.trim();
  if (clean in REGISTRY) return REGISTRY[clean];
  const norm = normalizeNit(clean);
  if (norm in REGISTRY) return REGISTRY[norm];
  // Match por prefijo de 9 dígitos (permite tolerar DV faltante en el trámite).
  const nine = norm.slice(0, 9);
  if (nine.length === 9 && nine in REGISTRY) return REGISTRY[nine];
  for (const key of Object.keys(REGISTRY)) {
    if (normalizeNit(key).startsWith(nine) && nine.length === 9) return REGISTRY[key];
  }
  return null;
}

/** Lista todos los NITs canónicos registrados (para logs / debug). */
export function listBancosSoportados(): string[] {
  return TEMPLATES.map((t) => `${t.nitBanco} (${t.nombreBanco})`);
}
