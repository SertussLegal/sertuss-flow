/**
 * legalProse — Helpers puros y testeables para construir prosa notarial
 * colombiana. Reusan los formatters base de `legalFormatters.ts` y añaden
 * la combinación letras+número exigida por el estándar notarial:
 *   "doscientos veintidós (222) de fecha veintinueve (29) de enero de
 *    mil novecientos setenta y uno (1971)".
 *
 * 100% puros: sin side effects, sin acceso a Supabase, sin DOM. Aptos
 * para ser duplicados en `supabase/functions/.../legalProse.ts` y usados
 * desde Deno sin cambios.
 */

import { formatMonedaLegal, numberToWords as numberToWordsLegal } from "@/lib/legalFormatters";

// ── Femeninos: ordinales 1..10 (estándar notarial colombiano) ────────────

const FEMENINOS_ORDINALES_1_10: Record<number, string> = {
  1: "primera",
  2: "segunda",
  3: "tercera",
  4: "cuarta",
  5: "quinta",
  6: "sexta",
  7: "séptima",
  8: "octava",
  9: "novena",
  10: "décima",
};

/**
 * Convierte un número masculino del helper base a femenino aplicando
 * sustituciones morfológicas seguras:
 *   "veintiún" / "veintiuno" → "veintiuna"
 *   "treinta y un" / "uno"   → "treinta y una"
 *   y en general "...y un" → "...y una".
 */
function masculinoAFemenino(words: string): string {
  let out = words;
  out = out.replace(/\bveintiun[oó]?\b/gi, "veintiuna");
  // "y un" final o seguido de espacio/fin
  out = out.replace(/\b(y)\s+un(o)?\b/gi, "$1 una");
  // "un" suelto al final (raro pero defensivo)
  out = out.replace(/(^|\s)un(o)?$/i, "$1una");
  return out;
}

/**
 * Devuelve el número combinado en letras y dígitos: `"doscientos veintidós (222)"`.
 *
 * - `gender = "masculine"` (default): forma masculina ("uno", "veintiuno").
 * - `gender = "feminine"`: forma femenina estricta. Para 1..10 usa la tabla
 *   de ordinales ("primera", "segunda", ..., "décima"). Para >10 sustituye
 *   morfológicamente.
 */
/**
 * Detecta si una cadena ya está en formato "<algo> (NNN)" o "<algo> ($NNN...)".
 * Idempotencia: si el input ya viene formateado, devolverlo intacto evita
 * doble envoltura tipo "treinta y cinco (35) (35)".
 */
const ALREADY_FORMATTED_RE = /\([\d.\s$,]+\)\s*$/;

export function numeroConLetras(
  n: number | string,
  gender: "masculine" | "feminine" = "masculine",
): string {
  // Idempotencia: si recibimos ya el string formateado, no re-envolver.
  if (typeof n === "string" && ALREADY_FORMATTED_RE.test(n.trim())) {
    return n.trim();
  }
  const num = typeof n === "string" ? parseInt(n.replace(/\D/g, ""), 10) : n;
  if (!Number.isFinite(num) || num <= 0) return "";

  if (gender === "feminine" && num >= 1 && num <= 10) {
    return `${FEMENINOS_ORDINALES_1_10[num]} (${num})`;
  }

  let words = numberToWordsLegal(num);
  if (gender === "feminine") words = masculinoAFemenino(words);
  return `${words} (${num})`;
}

// ── Fechas ───────────────────────────────────────────────────────────────

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Convierte una fecha ISO (YYYY-MM-DD) o DD-MM-YYYY/DD/MM/YYYY en prosa legal:
 *   "veintinueve (29) de enero de mil novecientos setenta y uno (1971)".
 * Devuelve "" si la fecha es inválida.
 */
export function fechaProsa(fecha: string): string {
  if (!fecha) return "";
  let dia: number, mes: number, anio: number;

  const ymd = fecha.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
  const dmy = fecha.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/);

  if (ymd) {
    anio = parseInt(ymd[1], 10);
    mes = parseInt(ymd[2], 10);
    dia = parseInt(ymd[3], 10);
  } else if (dmy) {
    dia = parseInt(dmy[1], 10);
    mes = parseInt(dmy[2], 10);
    anio = parseInt(dmy[3], 10);
  } else {
    return "";
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return "";
  return `${numeroConLetras(dia)} de ${MESES[mes - 1]} de ${numeroConLetras(anio)}`;
}

// ── Escritura pública (bloque hilado) ────────────────────────────────────

export interface EscrituraInput {
  numero: number | string | null | undefined;
  fecha: string | null | undefined;
  notariaNumero?: number | string | null;
  circulo?: string | null;
  tipo?: string;
}

/**
 * Devuelve el bloque de escritura pública en prosa unificada o `null` si
 * faltan los datos críticos (`numero` o `fecha`). El invocador decide si
 * colapsa o reduce la cláusula que la contiene.
 */
export function escrituraProsa(data: EscrituraInput): string | null {
  const numRaw = data.numero ?? "";
  const fechaRaw = (data.fecha ?? "").toString().trim();
  const numStr = numRaw.toString().replace(/\D/g, "");
  if (!numStr || !fechaRaw) return null;
  const fechaStr = fechaProsa(fechaRaw);
  if (!fechaStr) return null;

  const tipo = data.tipo?.trim() || "Escritura Pública";
  const numLetras = numeroConLetras(numStr, "masculine");

  let resultado = `${tipo} número ${numLetras} de fecha ${fechaStr}`;

  if (data.notariaNumero) {
    const notariaTxt = numeroConLetras(data.notariaNumero, "feminine");
    if (notariaTxt) resultado += ` otorgada en la Notaría ${notariaTxt}`;
    if (data.circulo && data.circulo.trim()) {
      resultado += ` del Círculo de ${data.circulo.trim()}`;
    }
  }
  return resultado;
}

// ── Montos ───────────────────────────────────────────────────────────────

/**
 * Devuelve el monto en formato notarial:
 *   "CIENTO OCHENTA Y CINCO MILLONES DE PESOS ($185.000.000)".
 * Reusa `formatMonedaLegal` y elimina el sufijo "M/CTE ,00" para ajustarse
 * al estilo de minuta correcta. Devuelve "" si el valor no es positivo.
 */
export function montoProsa(valor: string | number): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const raw = typeof valor === "number" ? valor.toString() : valor;
  const formatted = formatMonedaLegal(raw);
  if (!formatted) return "";
  // formatMonedaLegal → "CIENTO ... DE PESOS M/CTE ($185.000.000,00)"
  // Normalizamos al estilo de minuta correcta:
  //   "CIENTO ... DE PESOS ($185.000.000)"
  return formatted
    .replace(/\s+M\/CTE\s+/i, " ")
    .replace(/,00\)$/, ")")
    .trim();
}
