/**
 * Motor de tokens gramaticales notariales (backend compartido).
 *
 * Usado por todas las edge functions de generación docx
 * (procesar-cancelacion, y futuras: procesar-compraventa, procesar-hipoteca, …).
 *
 * Contrato: cada token tiene 3 formas — Masculino, Femenino y Combinado (fallback).
 * Si el frontend envía "" (incertidumbre) o el campo no existe → se inyecta el
 * combinado notarial estándar ("el(la) señor(a)", "identificado(a)").
 */

export type GeneroGramatical = "M" | "F" | "JURIDICA" | "";
export type TratamientoEntidad = "M" | "F" | "";

type FlexMap = { M: string; F: string; FALLBACK: string };

const flex = (g: GeneroGramatical | TratamientoEntidad | undefined, m: FlexMap): string => {
  if (g === "M") return m.M;
  if (g === "F") return m.F;
  return m.FALLBACK;
};

/** Tokens del deudor (persona natural). */
export function deudorTokens(g: GeneroGramatical | undefined) {
  return {
    art_deudor: flex(g, { M: "el señor", F: "la señora", FALLBACK: "el(la) señor(a)" }),
    tit_deudor: flex(g, { M: "deudor", F: "deudora", FALLBACK: "deudor(a)" }),
    id_deudor: flex(g, { M: "identificado", F: "identificada", FALLBACK: "identificado(a)" }),
  };
}

/**
 * Tokens plural-aware del deudor para casos con N deudores naturales.
 * - 1 deudor → delega en `deudorTokens` (singular).
 * - 2+ todos F → "las señoras / deudoras / identificadas".
 * - 2+ todos M → "los señores / deudores / identificados".
 * - Mixto u "" → fallback combinado "los(las) señores(as) / deudores(as) / identificados(as)".
 * Mantiene EXACTAMENTE las mismas claves que `deudorTokens` (art_deudor, tit_deudor, id_deudor)
 * → la plantilla v2 no nota la diferencia.
 */
export function deudoresTokens(deudores: Array<{ genero?: GeneroGramatical }>) {
  const n = deudores.length;
  if (n <= 1) return deudorTokens(deudores[0]?.genero);
  const todosF = deudores.every((d) => d.genero === "F");
  const todosM = deudores.every((d) => d.genero === "M");
  if (todosF) {
    return { art_deudor: "las señoras", tit_deudor: "deudoras", id_deudor: "identificadas" };
  }
  if (todosM) {
    return { art_deudor: "los señores", tit_deudor: "deudores", id_deudor: "identificados" };
  }
  return {
    art_deudor: "los(las) señores(as)",
    tit_deudor: "deudores(as)",
    id_deudor: "identificados(as)",
  };
}

/** Tokens del apoderado del banco (persona natural / vocero). */
export function apoderadoTokens(g: GeneroGramatical | undefined) {
  return {
    art_apoderado: flex(g, { M: "el señor", F: "la señora", FALLBACK: "el(la) señor(a)" }),
    tit_apoderado: flex(g, { M: "el apoderado", F: "la apoderada", FALLBACK: "el(la) apoderado(a)" }),
    id_apoderado: flex(g, { M: "identificado", F: "identificada", FALLBACK: "identificado(a)" }),
  };
}

/**
 * Tokens del banco (persona jurídica).
 * NO refleja masculino/femenino real — refleja la elección de tratamiento
 * corporativo notarial: "la entidad" vs "el establecimiento bancario".
 * Fallback seguro: "la entidad" (forma más común en escritura colombiana).
 */
export function bancoTokens(t: TratamientoEntidad | undefined) {
  return {
    art_banco: flex(t, {
      M: "el establecimiento bancario",
      F: "la entidad",
      FALLBACK: "la entidad",
    }),
    id_banco: flex(t, {
      M: "constituido y organizado",
      F: "constituida y organizada",
      FALLBACK: "constituida y organizada",
    }),
  };
}

/** Helper de inferencia (espejo del frontend, para casos donde el payload no trae género). */
const NOMBRES_F = new Set([
  "MARIA","ANA","ALEJANDRA","CLAUDIA","PATRICIA","SANDRA","DIANA","ANDREA","ANGELA",
  "LAURA","CAROLINA","PAOLA","NATALIA","CAMILA","VALENTINA","ISABELLA","SOFIA",
  "LUZ","MARTHA","ROSA","BEATRIZ","ESPERANZA","MERCEDES","TERESA","GLORIA","OLGA",
  "LUCIA","CARMEN","JIMENA","MARCELA","VIVIANA","JOHANNA","MILENA","LILIANA",
  "MONICA","ADRIANA","DANIELA","JULIANA","MARIANA","VANESSA","TATIANA","LORENA",
  "VERONICA","CRISTINA","CECILIA","ELIZABETH","CATALINA",
]);
const NOMBRES_M = new Set([
  "JUAN","JOSE","LUIS","CARLOS","JORGE","MIGUEL","PEDRO","PABLO","ANDRES","DAVID",
  "DANIEL","DIEGO","FERNANDO","RICARDO","ROBERTO","ALEJANDRO","SANTIAGO","SEBASTIAN",
  "EDWIN","STEVENS","ALEXANDER","MAURICIO","JULIAN","JAVIER","OSCAR","GUSTAVO",
  "GERMAN","HERNAN","ALVARO","FELIPE","ESTEBAN","MARTIN","EDUARDO","RAFAEL",
  "MANUEL","FRANCISCO","ANTONIO","HECTOR","HUGO","WILSON","WILLIAM","RODRIGO",
  "NICOLAS","TOMAS","GABRIEL","VICTOR","MARIO","ALBERTO",
]);
export function inferGeneroFromNombre(nombre: string): "M" | "F" | "" {
  const n = (nombre || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim().split(/\s+/)[0];
  if (!n) return "";
  if (NOMBRES_F.has(n)) return "F";
  if (NOMBRES_M.has(n)) return "M";
  return "";
}
