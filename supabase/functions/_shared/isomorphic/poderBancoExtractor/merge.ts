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
export const NULLY_STRINGS = new Set([
  "null", "NULL", "Null",
  "undefined", "UNDEFINED",
  "nan", "NaN", "NAN", "Nan",
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

/**
 * Cinturón de seguridad: elimina claves planas de `poder_banco` cuyo valor
 * sea un marcador literal basura (`"null"`, `"undefined"`, `"N/A"`, etc.).
 * Devuelve una copia — nunca muta el input. Bloques profundos v6
 * (`apoderado`, `poderdante`, `instrumento_poder`, ...) pasan tal cual.
 */
const FLAT_STRING_KEYS = [
  "apoderado_nombre",
  "apoderado_cedula",
  "apoderado_escritura",
  "apoderado_fecha",
  "apoderado_fecha_dia",
  "apoderado_fecha_mes",
  "apoderado_fecha_anio",
  "apoderado_notaria_poder",
] as const;

export function stripNullyStrings<T extends Record<string, unknown> | undefined | null>(
  pb: T,
  paths?: ReadonlyArray<readonly [string, string]>,
): T {
  if (!pb || typeof pb !== "object") return pb;
  const out: Record<string, unknown> = { ...(pb as Record<string, unknown>) };

  // Modo por rutas: limpia obj[sub][field] para cada (sub, field). Copia
  // superficial del subobjeto tocado — no muta el input.
  if (paths) {
    for (const [sub, field] of paths) {
      const child = out[sub];
      if (!child || typeof child !== "object") continue;
      const raw = (child as Record<string, unknown>)[field];
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed || NULLY_STRINGS.has(trimmed)) {
        const copy = { ...(child as Record<string, unknown>) };
        delete copy[field];
        out[sub] = copy;
      }
    }
    return out as T;
  }

  // Modo legacy: limpia FLAT_STRING_KEYS del propio objeto (poder_banco plano).
  for (const key of FLAT_STRING_KEYS) {
    const raw = out[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || NULLY_STRINGS.has(trimmed)) {
      delete out[key];
    }
  }
  return out as T;
}

/**
 * Rutas fuera de `poder_banco` que también pueden recibir strings tóxicas
 * de la IA monolítica (Gemini a veces devuelve `"null"` literal en cuantía
 * no legible en vez de omitir). Ampliar aquí — misma función, mismo set
 * `NULLY_STRINGS`, sin walker recursivo.
 */
export const CANCELACION_NULLY_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["hipoteca_anterior", "valor_hipoteca_original"],
  ["hipoteca_anterior", "cuantia_origen"],
];



/** Unwraps a confField `{valor, confianza}` a string plano, saneando "null"/etc. */
export function unwrapConf(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return sanitizeString(v);
  if (typeof v === "object" && v !== null && "valor" in (v as Record<string, unknown>)) {
    return sanitizeString((v as { valor?: unknown }).valor);
  }
  return undefined;
}

/** Regla 7 (v7-2026-07): además de exponer el `valor`, extrae `confianza`
 *  cuando viene como wrapper `{valor, confianza}`. Devuelve `undefined` si el
 *  input es string plano (dato histórico sin wrapper) o si `confianza` no
 *  aparece — el sidecar `_confianza` omite ese path y la Regla 7 no dispara. */
export function unwrapConfDeep(v: unknown): {
  valor?: string;
  confianza?: "alta" | "media" | "baja";
} {
  if (v == null) return {};
  if (typeof v === "string") {
    const s = sanitizeString(v);
    return s ? { valor: s } : {};
  }
  if (typeof v === "object" && v !== null && "valor" in (v as Record<string, unknown>)) {
    const obj = v as { valor?: unknown; confianza?: unknown };
    const valor = sanitizeString(obj.valor);
    const rawConf = typeof obj.confianza === "string" ? obj.confianza.trim().toLowerCase() : "";
    const confianza = (rawConf === "alta" || rawConf === "media" || rawConf === "baja")
      ? rawConf as "alta" | "media" | "baja"
      : undefined;
    return { valor, confianza };
  }
  return {};
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
  const cls = classifyApoderado(apoderadoIn, {
    instrumento_poder: deepV6.instrumento_poder ?? null,
    has_apoderado_banco_v3: deepV6.has_apoderado_banco_v3 ?? null,
  });

  const apoderadoOut = apoderadoIn
    ? { ...apoderadoIn, tipo: cls.tipoEfectivo ?? null }
    : null;

  const finalFlat: PoderBancoFlat = { ...(flatMerged || {}) };

  // V6-wins override: cuando el classifier NO degradó (tipoEfectivo !== null),
  // el bloque profundo V6 es más confiable que monolítico/dedicado legacy para
  // identificar al apoderado. Sobrescribe nombre/cédula planos con V6.
  if (apoderadoOut && cls.tipoEfectivo !== null) {
    if (cls.tipoEfectivo === "natural") {
      if (apoderadoOut.nombre) finalFlat.apoderado_nombre = String(apoderadoOut.nombre);
      if (apoderadoOut.cedula) finalFlat.apoderado_cedula = String(apoderadoOut.cedula);
    } else if (cls.tipoEfectivo === "juridica") {
      const reps = apoderadoOut.representantes || [];
      const firmante = reps.find((r) => r?.es_firmante && r?.nombre)
        || reps.find((r) => r?.nombre)
        || reps[0];
      if (firmante?.nombre) finalFlat.apoderado_nombre = String(firmante.nombre);
      if (firmante?.cedula) finalFlat.apoderado_cedula = String(firmante.cedula);
    }
  }

  // Fallback legacy (tipoEfectivo === null): rellenar huecos sin sobrescribir.
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

  // ─────────────────────────────────────────────────────────────
  // NO_LEGIBLE override (incondicional): si el bloque profundo declaró
  // explícitamente que un campo crítico es ilegible, esa señal SIEMPRE gana
  // sobre el plano monolítico. Corre incluso cuando el classifier degradó
  // `tipoEfectivo` a null — ese es justamente el caso donde el monolítico
  // podría estar alucinando (Ana María: cedula plano "41525143" mientras
  // el profundo marcó NO_LEGIBLE porque la imagen del PDF era mala).
  // ─────────────────────────────────────────────────────────────
  {
    const deepCedula = unwrapConf(deepV6.apoderado_cedula)
      ?? (apoderadoIn?.cedula ? String(apoderadoIn.cedula) : undefined);
    const deepEscritura = unwrapConf(deepV6.escritura_poder_num)
      ?? (deepV6.instrumento_poder?.escritura_num
        ? String(deepV6.instrumento_poder.escritura_num)
        : undefined);
    const deepFecha = unwrapConf(deepV6.fecha_poder)
      ?? (deepV6.instrumento_poder?.fecha
        ? String(deepV6.instrumento_poder.fecha)
        : undefined);

    if (deepCedula === "NO_LEGIBLE") finalFlat.apoderado_cedula = "NO_LEGIBLE";
    if (deepEscritura === "NO_LEGIBLE") finalFlat.apoderado_escritura = "NO_LEGIBLE";
    if (deepFecha === "NO_LEGIBLE") finalFlat.apoderado_fecha = "NO_LEGIBLE";
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
