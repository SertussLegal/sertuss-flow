// ── Legal Formatting Helpers for Colombian Notarial Documents ──

const UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TENS = ["", "diez", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function convertGroupLegal(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return n === 20 ? "veinte" : `veinti${UNITS[n % 10]}`;
  if (n < 100) {
    const t = Math.floor(n / 10), u = n % 10;
    return u === 0 ? TENS[t] : `${TENS[t]} y ${UNITS[u]}`;
  }
  const h = Math.floor(n / 100), rest = n % 100;
  if (h === 1 && rest === 0) return "cien";
  return rest === 0 ? HUNDREDS[h] : `${HUNDREDS[h]} ${convertGroupLegal(rest)}`;
}

export function numberToWords(num: number): string {
  return numberToWordsLegal(num);
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
    if (divisor === 1) {
      result += ` ${convertGroupLegal(q)}`;
    } else if (q === 1) {
      result += divisor === 1000 ? ` mil` : ` un ${singular}`;
    } else {
      result += ` ${convertGroupLegal(q)} ${plural}`;
    }
  }
  return result.trim();
}

/**
 * Formats a numeric string into Colombian notarial currency format.
 * "150000000" → "CIENTO CINCUENTA MILLONES DE PESOS M/CTE ($150.000.000,00)"
 */
export function formatMonedaLegal(valor: string): string {
  if (!valor) return "";
  const cleaned = valor.replace(/[$.\s]/g, "").replace(/,\d{2}$/, "").replace(/,/g, "");
  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num <= 0) return "";

  const words = numberToWordsLegal(num).toUpperCase();
  const formatted = num.toLocaleString("es-CO").replace(/,/g, ".");
  return `${words} DE PESOS M/CTE ($${formatted},00)`;
}

const MESES_LETRAS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Formats a date string into Colombian notarial legal format.
 * "02-02-2018" → "dos (2) de febrero de dos mil dieciocho (2018)"
 */
export function formatFechaLegal(fecha: string): string {
  if (!fecha) return "";

  let dia: number, mes: number, anio: number;

  // Try DD-MM-YYYY or DD/MM/YYYY
  const dmy = fecha.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/);
  if (dmy) {
    dia = parseInt(dmy[1], 10);
    mes = parseInt(dmy[2], 10);
    anio = parseInt(dmy[3], 10);
  } else {
    // Try YYYY-MM-DD
    const ymd = fecha.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
    if (ymd) {
      anio = parseInt(ymd[1], 10);
      mes = parseInt(ymd[2], 10);
      dia = parseInt(ymd[3], 10);
    } else {
      return "";
    }
  }

  if (isNaN(dia) || isNaN(mes) || isNaN(anio) || mes < 1 || mes > 12) return "";

  const diaLetras = numberToWordsLegal(dia);
  const mesLetras = MESES_LETRAS[mes - 1];
  const anioLetras = numberToWordsLegal(anio);

  return `${diaLetras} (${dia}) de ${mesLetras} de ${anioLetras} (${anio})`;
}

// ── Casing normalization for notarial style coherence ──
function toTitleCaseEs(s: string): string {
  const minor = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "a"]);
  return s
    .toLocaleLowerCase("es-CO")
    .split(/\s+/)
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && minor.has(w)) return w;
      return w.charAt(0).toLocaleUpperCase("es-CO") + w.slice(1);
    })
    .join(" ");
}

/**
 * Normalizes user-typed values for notarial-style coherence.
 * Default = MAYÚSCULAS (Spanish locale, preserves accents).
 * Numeric / date / explicit-suffix fields are passed through or cased accordingly.
 */
export function normalizeFieldCasing(field: string, value: string): string {
  if (!value) return value;
  const v = value.trim();
  if (!v) return v;
  const f = field.toLowerCase();

  // Explicit casing suffixes win
  if (f.endsWith("_lower")) return v.toLocaleLowerCase("es-CO");
  if (f.endsWith("_proper")) return toTitleCaseEs(v);

  // Dates → passthrough (formatting handled elsewhere)
  if (/fecha/.test(f)) return v;

  // Pure numerics (avoid touching "_letras" variants)
  const isNumericField =
    /(numero|ordinal|decreto|nit|cedula|matricula|chip|catastral|estrato|area|avaluo|valor|saldo|pago)/.test(f) &&
    !/letras/.test(f);
  if (isNumericField) return v;

  // Default: MAYÚSCULAS con tildes preservadas
  return v.toLocaleUpperCase("es-CO");
}

/**
 * Formats a cédula number with dots and expedition place.
 * "79681841", "Bogotá D.C." → "79.681.841 expedida en Bogotá D.C."
 */
export function formatCedulaLegal(cedula: string, expedicion?: string): string {
  if (!cedula) return "";
  const cleaned = cedula.replace(/\D/g, "");
  const formatted = parseInt(cleaned, 10).toLocaleString("es-CO").replace(/,/g, ".");
  if (expedicion) {
    return `${formatted} expedida en ${expedicion}`;
  }
  return formatted;
}

// ── Helpers notariales para el bloque "Notaría N°" ──

const ORDINALES_FEMENINOS_1_10 = [
  "", "PRIMERA", "SEGUNDA", "TERCERA", "CUARTA", "QUINTA",
  "SEXTA", "SÉPTIMA", "OCTAVA", "NOVENA", "DÉCIMA",
];

/**
 * Convierte un número de notaría a su representación en letras (femenino).
 * En español notarial colombiano "la notaría" es femenino.
 *  - 1..10 → ordinales (PRIMERA, QUINTA, DÉCIMA…)
 *  - >10   → cardinal en femenino (VEINTIUNA, SESENTA Y CINCO…)
 * Output siempre en MAYÚSCULAS.
 */
export function numeroNotariaToLetras(n: number | string): string {
  const num = typeof n === "string" ? parseInt(n.replace(/\D/g, ""), 10) : n;
  if (!Number.isFinite(num) || num <= 0) return "";
  if (num <= 10) return ORDINALES_FEMENINOS_1_10[num];
  // Cardinal en femenino: ajustar terminaciones masculinas → femeninas
  let words = numberToWordsLegal(num);
  // "veintiún" / "veintiuno" → "veintiuna"
  words = words.replace(/\bveintiun[oó]?\b/gi, "veintiuna");
  // "un" final o aislado → "una"
  words = words.replace(/(^|\s)un(\s|$)/gi, "$1una$2");
  return words.toLocaleUpperCase("es-CO");
}

export type FormatoOrdinal = "volada" | "to";

/**
 * Genera la abreviatura ordinal del número de notaría.
 *  - "volada" (default, estándar elegante en escrituras): 5 → "5.ª", 21 → "21.ª"
 *  - "to" (estilo histórico): 5 → "5ta", 21 → "21a"
 * Siempre femenino (la notaría).
 */
export function numeroToOrdinalAbbr(n: number | string, formato: FormatoOrdinal = "volada"): string {
  const num = typeof n === "string" ? parseInt(n.replace(/\D/g, ""), 10) : n;
  if (!Number.isFinite(num) || num <= 0) return "";
  if (formato === "volada") return `${num}.ª`;
  // formato "to" — sufijos comunes en práctica notarial colombiana
  const sufijos: Record<number, string> = { 1: "ra", 2: "da", 3: "ra", 4: "ta", 5: "ta", 6: "ta", 7: "ma", 8: "va", 9: "na", 10: "ma" };
  return `${num}${sufijos[num] ?? "a"}`;
}

/**
 * Detecta el formato del ordinal almacenado.
 */
export function detectarFormatoOrdinal(ordinal: string): FormatoOrdinal {
  if (!ordinal) return "volada";
  return /\.[ºª]/.test(ordinal) ? "volada" : "to";
}
