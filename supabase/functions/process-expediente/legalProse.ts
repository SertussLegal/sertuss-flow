/**
 * legalProse — copia local para la Edge Function (Deno).
 * Mantener sincronizada con `src/lib/legalProse.ts`.
 *
 * Las helpers son puras: no acceden a Supabase ni al DOM. Aquí
 * incluimos también las dependencias mínimas de `legalFormatters`
 * (numberToWordsLegal y formatMonedaLegal) para evitar imports
 * con alias de Vite.
 */

const UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const TENS = ["", "diez", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function convertGroup(n: number): string {
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

function formatMonedaLegal(valor: string): string {
  if (!valor) return "";
  const cleaned = valor.replace(/[$.\s]/g, "").replace(/,\d{2}$/, "").replace(/,/g, "");
  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num <= 0) return "";
  const words = numberToWordsLegal(num).toUpperCase();
  const formatted = num.toLocaleString("es-CO").replace(/,/g, ".");
  return `${words} DE PESOS ($${formatted})`;
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
  // Idempotencia: si recibimos ya un string formateado, no re-envolver.
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

export interface EscrituraInput {
  numero: number | string | null | undefined;
  fecha: string | null | undefined;
  notariaNumero?: number | string | null;
  circulo?: string | null;
  tipo?: string;
}

export function escrituraProsa(data: EscrituraInput): string | null {
  const numStr = (data.numero ?? "").toString().replace(/\D/g, "");
  const fechaRaw = (data.fecha ?? "").toString().trim();
  if (!numStr || !fechaRaw) return null;
  const fechaStr = fechaProsa(fechaRaw);
  if (!fechaStr) return null;
  const tipo = data.tipo?.trim() || "Escritura Pública";
  let resultado = `${tipo} número ${numeroConLetras(numStr, "masculine")} de fecha ${fechaStr}`;
  if (data.notariaNumero) {
    const notariaTxt = numeroConLetras(data.notariaNumero, "feminine");
    if (notariaTxt) resultado += ` otorgada en la Notaría ${notariaTxt}`;
    if (data.circulo && data.circulo.trim()) {
      resultado += ` del Círculo de ${data.circulo.trim()}`;
    }
  }
  return resultado;
}

export function montoProsa(valor: string | number): string {
  if (valor === null || valor === undefined || valor === "") return "";
  // Idempotencia: si ya viene formateado tipo "... ($NNN)" o "... ($NNN,00)", devolverlo.
  if (typeof valor === "string" && /\(\$[\d.,]+\)\s*$/.test(valor.trim())) {
    return valor.trim().replace(/,00\)$/, ")");
  }
  const raw = typeof valor === "number" ? valor.toString() : valor;
  const formatted = formatMonedaLegal(raw);
  if (!formatted) return "";
  // formatMonedaLegal → "... DE PESOS M/CTE ($NNN,00)"
  // Estilo notarial registral colombiano: mantener M/CTE, quitar solo ",00".
  return formatted.replace(/,00\)$/, ")").trim();
}

