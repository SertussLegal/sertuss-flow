// ============================================================================
// poderBancoExtractor/divergenciaLecturas.ts — Regla 9: doble lectura
// independiente (extractor DEDICADO vs extractor V6 profundo).
//
// Motivación (riesgo C6): cuando la cédula/escritura/fecha del apoderado
// aparece UNA sola vez en el poder, las Reglas 5/6 (coherencia intra-documento
// por menciones) no tienen con qué comparar, y la Regla 7 (confianza) no
// dispara porque Gemini reporta "alta" incluso equivocándose. El pipeline ya
// hace DOS lecturas independientes del mismo PDF (llamada dedicada Flash +
// llamada V6 Flash); contrastarlas es gratis y cierra el hueco.
//
// ⚠️ FAIRNESS DE FORMATO: los dos prompts piden formatos DISTINTOS a propósito
//   - cédula:    dedicado "79.123.456"                         | V6 "79123456"
//   - escritura: dedicado "DOS MIL ... (2415)"                 | V6 "2415"
//   - fecha:     dedicado "DIECINUEVE (19) DE AGOSTO DE ..."   | V6 "19-08-2025"
// Comparar en crudo produciría 100% de falsos positivos. Por eso TODA
// comparación pasa por un normalizador, y cuando el normalizador NO logra
// entender un lado con certeza devuelve "" → la comparación se OMITE.
// Nunca bloqueamos por un formato que no entendemos.
//
// 🛡️ PUREZA: solo TS. Isomórfico (edge + client + vitest). Sin fetch, sin I/O.
// ============================================================================

import { normalizeCedula } from "./validate.ts";

/** Valores que no representan una lectura real y por lo tanto no son
 *  comparables. Mismo patrón que `normalizeNombreFirmante` en validate.ts. */
const NO_COMPARABLE = new Set(["", "NO_LEGIBLE", "N/A", "NULL", "UNDEFINED"]);

function comparableRaw(raw: string | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (NO_COMPARABLE.has(s.toUpperCase())) return "";
  return s;
}

/** Extrae el número de escritura de texto libre.
 *  Estrategia: si hay grupos entre paréntesis con dígitos, gana el ÚLTIMO
 *  (formato notarial "DOS MIL CUATROCIENTOS QUINCE (2415)"); si no, se toman
 *  todos los dígitos del string ("No. 2.415" → "2415"). Los ceros a la
 *  izquierda se descartan para que "02415" === "2415".
 *  Devuelve "" si no hay dígitos. Nunca interpreta la parte en letras. */
export function normalizeEscrituraNum(raw: string | null | undefined): string {
  const s = comparableRaw(raw);
  if (!s) return "";
  const parens = [...s.matchAll(/\(([^)]*)\)/g)]
    .map((m) => m[1].replace(/\D/g, ""))
    .filter((d) => d.length > 0);
  const digits = parens.length > 0 ? parens[parens.length - 1] : s.replace(/\D/g, "");
  if (!digits) return "";
  const trimmed = digits.replace(/^0+/, "");
  return trimmed || "0";
}

const MESES_ES: Record<string, string> = {
  ENERO: "01",
  FEBRERO: "02",
  MARZO: "03",
  ABRIL: "04",
  MAYO: "05",
  JUNIO: "06",
  JULIO: "07",
  AGOSTO: "08",
  SEPTIEMBRE: "09",
  SETIEMBRE: "09",
  OCTUBRE: "10",
  NOVIEMBRE: "11",
  DICIEMBRE: "12",
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normaliza una fecha a "AAAA-MM-DD" para comparación.
 *  Acepta:
 *    - "DD-MM-AAAA" / "DD/MM/AAAA" (formato que pide el schema V6)
 *    - "AAAA-MM-DD" (ISO, por si el modelo desobedece)
 *    - prosa notarial: día en el primer paréntesis, año en el paréntesis de
 *      4 dígitos, mes por nombre en letras.
 *  Devuelve "" si no puede determinar los 3 componentes CON CERTEZA. En
 *  particular, ante ambigüedad día/mes sin desempate seguro devuelve "" —
 *  jamás adivina, porque un falso positivo aquí bloquea un trámite real. */
export function normalizeFechaComparable(raw: string | null | undefined): string {
  const s0 = comparableRaw(raw);
  if (!s0) return "";
  const s = stripAccents(s0).toUpperCase();

  // ── Caso ISO explícito: AAAA-MM-DD (año primero, sin ambigüedad).
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const mm = Number(iso[2]);
    const dd = Number(iso[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
    return `${iso[1]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  // ── Caso plano DD-MM-AAAA (el que pide el schema V6).
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const dd = Number(dmy[1]);
    const mm = Number(dmy[2]);
    // Si el primer componente no puede ser día, o el segundo no puede ser
    // mes, el string no respeta el contrato → no adivinamos.
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
    return `${dmy[3]}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  // ── Caso prosa notarial.
  //    Mes: por nombre (no numérico) → sin ambigüedad día/mes posible.
  let mes = "";
  for (const [nombre, num] of Object.entries(MESES_ES)) {
    if (new RegExp(`\\b${nombre}\\b`).test(s)) {
      // Dos meses distintos mencionados → ambiguo, abortar.
      if (mes && mes !== num) return "";
      mes = num;
    }
  }
  if (!mes) return "";

  const grupos = [...s.matchAll(/\((\s*\d{1,4}\s*)\)/g)].map((m) => m[1].trim());
  if (grupos.length === 0) return "";
  const anio = grupos.find((g) => g.length === 4);
  const dia = grupos.find((g) => g.length <= 2);
  if (!anio || !dia) return "";
  const dd = Number(dia);
  if (dd < 1 || dd > 31) return "";
  return `${anio}-${mes}-${String(dd).padStart(2, "0")}`;
}

export interface DivergenciaCampo {
  dedicado: string;
  v6: string;
}

export type DivergenciaLecturasKey =
  | "apoderado_cedula"
  | "escritura_poder_num"
  | "fecha_poder";

export type DivergenciaLecturas = Partial<
  Record<DivergenciaLecturasKey, DivergenciaCampo>
>;

/** Lado plano del extractor dedicado (5 campos legacy). */
export interface DedicadoLadoDivergencia {
  apoderado_cedula?: string | null;
  apoderado_escritura?: string | null;
  apoderado_fecha?: string | null;
}

/**
 * Regla 9 — contrasta la lectura DEDICADA contra la lectura V6 para los 3
 * campos críticos del apoderado. Debe invocarse con los valores CRUDOS de
 * cada lectura, ANTES de que la precedencia `??` de `mergePoderBancoV6` los
 * colapse y antes del override NO_LEGIBLE.
 *
 * Se omite la comparación (no cuenta como divergencia) cuando cualquiera de
 * los dos lados es nully, vacío, NO_LEGIBLE, o no normaliza a un valor
 * cierto. Solo se reporta cuando AMBOS lados normalizan y difieren.
 */
export function detectarDivergenciaLecturas(
  dedicadoFlat: DedicadoLadoDivergencia | null,
  v6Cedula: string | null | undefined,
  v6Escritura: string | null | undefined,
  v6Fecha: string | null | undefined,
): DivergenciaLecturas {
  const out: DivergenciaLecturas = {};
  if (!dedicadoFlat) return out;

  const checks: Array<{
    key: DivergenciaLecturasKey;
    dedicadoRaw: string | null | undefined;
    v6Raw: string | null | undefined;
    normalize: (v: string | null | undefined) => string;
  }> = [
    {
      key: "apoderado_cedula",
      dedicadoRaw: dedicadoFlat.apoderado_cedula,
      v6Raw: v6Cedula,
      normalize: (v) => normalizeCedula(comparableRaw(v)),
    },
    {
      key: "escritura_poder_num",
      dedicadoRaw: dedicadoFlat.apoderado_escritura,
      v6Raw: v6Escritura,
      normalize: normalizeEscrituraNum,
    },
    {
      key: "fecha_poder",
      dedicadoRaw: dedicadoFlat.apoderado_fecha,
      v6Raw: v6Fecha,
      normalize: normalizeFechaComparable,
    },
  ];

  for (const chk of checks) {
    if (!comparableRaw(chk.dedicadoRaw) || !comparableRaw(chk.v6Raw)) continue;
    const a = chk.normalize(chk.dedicadoRaw);
    const b = chk.normalize(chk.v6Raw);
    if (!a || !b) continue;          // formato no entendido → omitir
    if (a === b) continue;
    out[chk.key] = { dedicado: a, v6: b };
  }

  return out;
}
