// ============================================================================
// legalProse — Isomórfico (Deno + Vite). Helpers puros de prosa notarial.
// Copia consolidada de supabase/functions/process-expediente/legalProse.ts
// para eliminar el path relativo cruzado. Este archivo NO importa nada
// externo — es 100 % TS puro.
// ============================================================================

const UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TENS = ["", "diez", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
const VEINTIS = ["veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];

function convertGroup(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return n === 20 ? "veinte" : VEINTIS[n - 20];
  if (n < 100) {
    const t = Math.floor(n / 10), u = n % 10;
    return u === 0 ? TENS[t] : `${TENS[t]} y ${UNITS[u]}`;
  }
  const h = Math.floor(n / 100), rest = n % 100;
  if (h === 1 && rest === 0) return "cien";
  return rest === 0 ? HUNDREDS[h] : `${HUNDREDS[h]} ${convertGroup(rest)}`;
}

function numberToWordsLegal(num: number): string {
  if (num === 0) return "cero";
  const groups: [number, string, string][] = [
    [1_000_000_000, "mil millones", "mil millones"],
    [1_000_000, "millón", "millones"],
    [1_000, "mil", "mil"],
    [1, "", ""],
  ];
  let result = "";
  let remaining = num;
  for (const [divisor, singular, plural] of groups) {
    const q = Math.floor(remaining / divisor);
    remaining = remaining % divisor;
    if (q === 0) continue;
    if (divisor === 1) result += ` ${convertGroup(q)}`;
    else if (q === 1) result += divisor === 1000 ? ` mil` : ` un ${singular}`;
    else result += ` ${convertGroup(q)} ${plural}`;
  }
  return result.trim();
}

const FEMENINOS_ORDINALES_1_10: Record<number, string> = {
  1: "primera", 2: "segunda", 3: "tercera", 4: "cuarta", 5: "quinta",
  6: "sexta", 7: "séptima", 8: "octava", 9: "novena", 10: "décima",
};

function masculinoAFemenino(words: string): string {
  let out = words;
  out = out.replace(/\bveintiun[oó]?\b/gi, "veintiuna");
  out = out.replace(/\b(y)\s+un(o)?\b/gi, "$1 una");
  out = out.replace(/(^|\s)un(o)?$/i, "$1una");
  return out;
}

const ALREADY_FORMATTED_RE = /\([\d.\s$,]+\)\s*$/;

export function numeroConLetras(
  n: number | string,
  gender: "masculine" | "feminine" = "masculine",
): string {
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

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function fechaProsa(fecha: string): string {
  if (!fecha) return "";
  let dia: number, mes: number, anio: number;
  const ymd = fecha.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
  const dmy = fecha.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/);
  if (ymd) { anio = parseInt(ymd[1], 10); mes = parseInt(ymd[2], 10); dia = parseInt(ymd[3], 10); }
  else if (dmy) { dia = parseInt(dmy[1], 10); mes = parseInt(dmy[2], 10); anio = parseInt(dmy[3], 10); }
  else return "";
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return "";
  return `${numeroConLetras(dia)} de ${MESES[mes - 1]} de ${numeroConLetras(anio)}`;
}
