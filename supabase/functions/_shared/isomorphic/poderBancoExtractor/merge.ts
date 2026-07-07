// ============================================================================
// poderBancoExtractor/merge.ts — Merge determinista v6 ISOMÓRFICO.
//
// Combina:
//   - `monolitico`: campos planos legacy del OCR monolítico (Gemini 2.5 Pro)
//   - `dedicadoFlat`: campos planos del extractor dedicado legacy
//   - `deepV6`: schema profundo del extractor v6 (isomórfico, cuando el flag
//     POWER_V6_EXTRACTOR_ENABLED está encendido en la edge)
//
// Aplica `classifyApoderado` para consolidar `apoderado.tipo` con reglas de
// degradación defensiva (humano-legible motivos).
//
// 🛡️ PUREZA: solo TS. Testeado por `src/shared/poderBancoExtractor/*.test.ts`.
// ============================================================================

import type { PoderBancoDeepPayload } from "./index.ts";
import { classifyApoderado, type ApoderadoPayload } from "../apoderadoClassifier.ts";

/** Contrato mínimo del PoderBanco plano legacy (consumido por buildDocxVars). */
export interface PoderBancoFlat {
  apoderado_nombre?: string;
  apoderado_cedula?: string;
  apoderado_escritura?: string;
  apoderado_fecha?: string;
  apoderado_fecha_dia?: string;
  apoderado_fecha_mes?: string;
  apoderado_fecha_anio?: string;
  apoderado_notaria_poder?: string;
}

/** Resultado del extractor dedicado plano (5 campos que Gemini rellena). */
export interface DedicadoFlatResult {
  apoderado_nombre?: string | null;
  apoderado_cedula?: string | null;
  apoderado_escritura?: string | null;
  apoderado_fecha?: string | null;
  apoderado_notaria_poder?: string | null;
}

/** Marcadores literales que la IA a veces devuelve como string. Deben tratarse como ausencia real. */
const NULLY_STRINGS = new Set([
  "null", "NULL", "Null",
  "undefined", "UNDEFINED",
  "n/a", "N/A", "N/a",
  "na", "NA",
  "none", "NONE", "None",
  "---", "--", "-",
  "?", "??",
]);

/** Normaliza cualquier string a string real, o undefined si es vacío/nully. */
export function sanitizeString(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (NULLY_STRINGS.has(trimmed)) return undefined;
  return trimmed;
}

/** Unwraps a confField `{valor, confianza}` a string plano, saneando "null"/etc. */
export function unwrapConf(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return sanitizeString(v);
  if (typeof v === "object" && v !== null && "valor" in (v as Record<string, unknown>)) {
    return sanitizeString((v as { valor?: unknown }).valor);
  }
  return undefined;
}


/** Merge plano legacy (equivalente al `mergePoderBanco` interno de la edge). */
export function mergePoderBancoFlat(
  monolitico: PoderBancoFlat | undefined,
  dedicado: DedicadoFlatResult | null,
): PoderBancoFlat | undefined {
  if (!monolitico && !dedicado) return undefined;
  const pick = (m?: string | null, d?: string | null): string | undefined => {
    return sanitizeString(m) ?? sanitizeString(d);
  };

  const merged: PoderBancoFlat = {
    apoderado_nombre: pick(monolitico?.apoderado_nombre, dedicado?.apoderado_nombre),
    apoderado_cedula: pick(monolitico?.apoderado_cedula, dedicado?.apoderado_cedula),
    apoderado_escritura: pick(monolitico?.apoderado_escritura, dedicado?.apoderado_escritura),
    apoderado_fecha: pick(monolitico?.apoderado_fecha, dedicado?.apoderado_fecha),
    apoderado_notaria_poder: pick(monolitico?.apoderado_notaria_poder, dedicado?.apoderado_notaria_poder),
  };
  if (monolitico?.apoderado_fecha_dia) merged.apoderado_fecha_dia = monolitico.apoderado_fecha_dia;
  if (monolitico?.apoderado_fecha_mes) merged.apoderado_fecha_mes = monolitico.apoderado_fecha_mes;
  if (monolitico?.apoderado_fecha_anio) merged.apoderado_fecha_anio = monolitico.apoderado_fecha_anio;
  const hasAny = Object.values(merged).some((v) => v !== undefined && v !== "");
  return hasAny ? merged : undefined;
}

/**
 * Merge v6: combina flat legacy con schema profundo v6 y aplica
 * `classifyApoderado` para consolidar `apoderado.tipo`. El resultado es
 * un objeto extendido con `apoderado`, `poderdante`, `instrumento_poder`.
 */
export function mergePoderBancoV6(
  monolitico: PoderBancoFlat | undefined,
  dedicadoFlat: DedicadoFlatResult | null,
  deepV6: PoderBancoDeepPayload | null,
): (PoderBancoFlat & Record<string, unknown>) | undefined {
  const v6Flat: DedicadoFlatResult | null = deepV6
    ? {
        apoderado_nombre: unwrapConf(deepV6.apoderado_nombre) ?? null,
        apoderado_cedula: unwrapConf(deepV6.apoderado_cedula) ?? null,
        apoderado_escritura: unwrapConf(deepV6.escritura_poder_num) ?? null,
        apoderado_fecha: unwrapConf(deepV6.fecha_poder) ?? null,
        apoderado_notaria_poder: unwrapConf(deepV6.notaria_poder) ?? null,
      }
    : null;

  const combinedDedicado: DedicadoFlatResult | null = v6Flat || dedicadoFlat
    ? {
        apoderado_nombre: v6Flat?.apoderado_nombre ?? dedicadoFlat?.apoderado_nombre ?? null,
        apoderado_cedula: v6Flat?.apoderado_cedula ?? dedicadoFlat?.apoderado_cedula ?? null,
        apoderado_escritura: v6Flat?.apoderado_escritura ?? dedicadoFlat?.apoderado_escritura ?? null,
        apoderado_fecha: v6Flat?.apoderado_fecha ?? dedicadoFlat?.apoderado_fecha ?? null,
        apoderado_notaria_poder: v6Flat?.apoderado_notaria_poder ?? dedicadoFlat?.apoderado_notaria_poder ?? null,
      }
    : null;

  const flatMerged = mergePoderBancoFlat(monolitico, combinedDedicado);

  if (!deepV6) return flatMerged as (PoderBancoFlat & Record<string, unknown>) | undefined;

  const apoderadoIn = (deepV6.apoderado ?? undefined) as ApoderadoPayload | undefined;
  const cls = classifyApoderado(apoderadoIn);
  const apoderadoOut = apoderadoIn
    ? { ...apoderadoIn, tipo: cls.tipoEfectivo ?? null }
    : null;

  const finalFlat: PoderBancoFlat = { ...(flatMerged || {}) };
  if (!finalFlat.apoderado_nombre && apoderadoOut?.tipo === "juridica") {
    const reps = apoderadoOut.representantes || [];
    const primer = reps.find((r) => r?.nombre) || reps[0];
    if (primer?.nombre) finalFlat.apoderado_nombre = String(primer.nombre);
    if (primer?.cedula && !finalFlat.apoderado_cedula) finalFlat.apoderado_cedula = String(primer.cedula);
  }
  if (!finalFlat.apoderado_nombre && apoderadoOut?.tipo === "natural" && apoderadoOut.nombre) {
    finalFlat.apoderado_nombre = String(apoderadoOut.nombre);
    if (apoderadoOut.cedula && !finalFlat.apoderado_cedula) finalFlat.apoderado_cedula = String(apoderadoOut.cedula);
  }

  const out: Record<string, unknown> = {
    ...finalFlat,
    apoderado: apoderadoOut ?? undefined,
    poderdante: deepV6.poderdante ?? undefined,
    instrumento_poder: deepV6.instrumento_poder ?? undefined,
    facultades: deepV6.facultades ?? undefined,
    vigencia: deepV6.vigencia ?? undefined,
    has_apoderado_banco_v3: deepV6.has_apoderado_banco_v3,
    motivos_incompletitud: deepV6.motivos_incompletitud,
    _classifier_motivos: cls.motivos,
  };

  const hasSignal =
    Object.values(finalFlat).some((v) => v != null && String(v).trim() !== "") ||
    !!apoderadoOut ||
    !!deepV6.poderdante ||
    !!deepV6.instrumento_poder;
  return hasSignal ? (out as PoderBancoFlat & Record<string, unknown>) : undefined;
}
