// ============================================================================
// poderBancoExtractor/validate.ts — Validación determinista de coherencia
// interna del bloque `poder_banco` MERGEADO (Parte 2 del endurecimiento V6).
//
// Detecta alucinaciones/incoherencias del OCR mediante cross-checks que NO
// dependen de que Gemini reporte "baja confianza": son reglas puras sobre el
// payload final. Nunca bloquea; solo marca `warnings` y `suspicious` para
// que el pipeline los persista y la UI los muestre.
//
// 🛡️ PUREZA: solo TS. Isomórfico (edge + client). Sin fetch, sin Deno.
// ============================================================================

/** Extrae los dígitos "canónicos" de un número de escritura.
 *  Prioriza el paréntesis final `... (2814)` → "2814"; si no hay, toma los
 *  dígitos crudos. Devuelve undefined si no hay nada útil. */
export function extractEscrituraDigits(s: string | undefined | null): string | undefined {
  if (!s || typeof s !== "string") return undefined;
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const paren = trimmed.match(/\((\d+)\)\s*$/);
  if (paren) return paren[1];
  const raw = trimmed.replace(/\D/g, "");
  return raw || undefined;
}

/** Extrae el año (4 dígitos) de una fecha. Acepta "2024-01-15", "15/01/2024",
 *  "QUINCE (15) DE ENERO DE DOS MIL VEINTICUATRO (2024)", etc. */
export function extractYear(s: string | undefined | null): string | undefined {
  if (!s || typeof s !== "string") return undefined;
  const m = s.match(/(19|20)\d{2}/g);
  if (!m || m.length === 0) return undefined;
  // Devolver el último match (fechas en español ponen el año al final).
  return m[m.length - 1];
}

/** Cédula colombiana: 6 a 10 dígitos, sin guiones ni letras.
 *  Puntos y espacios se normalizan antes de validar (formato "79.123.456" OK). */
const CEDULA_RE = /^\d{6,10}$/;
export function isCedulaValida(c: string | undefined | null): boolean {
  if (!c) return true; // ausencia ≠ inválida
  if (typeof c !== "string") return false;
  const norm = c.replace(/[.\s]/g, "");
  return CEDULA_RE.test(norm);
}

/** Detecta el centinela textual "NO_LEGIBLE" emitido por el OCR cuando el
 *  campo aparece en el documento pero no se puede leer con certeza. */
export function isNoLegible(v: unknown): boolean {
  return typeof v === "string" && v.trim() === "NO_LEGIBLE";
}

/** Labels humanos para los warnings. Persistidos en `system_events` (los IDs
 *  son estables — no cambiar sin migración). */
export const WARNING_LABELS: Record<string, string> = {
  escritura_num_incoherente:
    "El número de escritura del poder no coincide entre bloques (extracción y detalle profundo)",
  fecha_incoherente:
    "El año del poder no coincide entre bloques (extracción y detalle profundo)",
  cedula_formato_invalido:
    "Una cédula extraída no cumple el formato colombiano (6 a 10 dígitos, sin guiones ni letras)",
  apoderado_coincide_con_rl_banco:
    "La cédula del apoderado coincide con la del representante legal del banco — probable confusión del OCR",
  apoderado_cedula_no_legible:
    "El OCR marcó la cédula del apoderado como no legible — verifícala manualmente contra el documento original antes de firmar",
  escritura_poder_no_legible:
    "El OCR marcó el número de escritura del poder como no legible — verifícalo manualmente contra el documento original",
  fecha_poder_no_legible:
    "El OCR marcó la fecha del poder como no legible — verifícala manualmente contra el documento original",
};

/** Labels humanos por path de campo sospechoso. Consumidos por la UI para
 *  marcar el input correspondiente. */
export const SUSPICIOUS_FIELD_LABELS: Record<string, string> = {
  "apoderado_escritura": "Número de escritura (plano)",
  "instrumento_poder.escritura_num": "Número de escritura (detalle profundo)",
  "apoderado_fecha": "Fecha del poder (plano)",
  "instrumento_poder.fecha": "Fecha del poder (detalle profundo)",
  "apoderado_cedula": "Cédula del apoderado (plano)",
  "apoderado.cedula": "Cédula del apoderado (detalle profundo)",
  "poderdante.representante_legal_cedula": "Cédula del representante legal del banco",
};

export interface CoherenciaResult {
  warnings: string[];
  suspicious: Set<string>;
}

/** Ejecuta las 4 reglas de coherencia sobre un payload `poder_banco` ya
 *  mergeado. Nunca lanza; devuelve resultado vacío si no hay señales. */
export function validatePoderBancoCoherencia(
  merged: Record<string, unknown> | null | undefined,
): CoherenciaResult {
  const warnings: string[] = [];
  const suspicious = new Set<string>();
  if (!merged || typeof merged !== "object") return { warnings, suspicious };

  const apoderadoEscritura = merged.apoderado_escritura as string | undefined;
  const apoderadoFecha = merged.apoderado_fecha as string | undefined;
  const apoderadoCedulaPlano = merged.apoderado_cedula as string | undefined;
  const instr = (merged.instrumento_poder ?? null) as Record<string, unknown> | null;
  const instrEscritura = instr?.escritura_num as string | undefined;
  const instrFecha = instr?.fecha as string | undefined;
  const apoderado = (merged.apoderado ?? null) as Record<string, unknown> | null;
  const apoderadoCedulaDeep = apoderado?.cedula as string | undefined;
  const poderdante = (merged.poderdante ?? null) as Record<string, unknown> | null;
  const rlCedula = poderdante?.representante_legal_cedula as string | undefined;
  const representantes = (apoderado?.representantes ?? []) as Array<Record<string, unknown>>;

  // Regla 2.1 — Escritura incoherente entre plano y profundo.
  const eA = extractEscrituraDigits(apoderadoEscritura);
  const eB = extractEscrituraDigits(instrEscritura);
  if (eA && eB && eA !== eB) {
    warnings.push("escritura_num_incoherente");
    suspicious.add("apoderado_escritura");
    suspicious.add("instrumento_poder.escritura_num");
  }

  // Regla 2.1b — Fecha incoherente (año) entre plano y profundo.
  const yA = extractYear(apoderadoFecha);
  const yB = extractYear(instrFecha);
  if (yA && yB && yA !== yB) {
    warnings.push("fecha_incoherente");
    suspicious.add("apoderado_fecha");
    suspicious.add("instrumento_poder.fecha");
  }

  // Regla 2.2 — Formato de cédula colombiana.
  const cedulaPaths: Array<[string, string | undefined]> = [
    ["apoderado_cedula", apoderadoCedulaPlano],
    ["apoderado.cedula", apoderadoCedulaDeep],
    ["poderdante.representante_legal_cedula", rlCedula],
  ];
  representantes.forEach((rep, i) => {
    cedulaPaths.push([`apoderado.representantes[${i}].cedula`, rep?.cedula as string | undefined]);
  });
  let anyInvalid = false;
  for (const [path, val] of cedulaPaths) {
    if (val && !isCedulaValida(val)) {
      suspicious.add(path);
      anyInvalid = true;
    }
  }
  if (anyInvalid) warnings.push("cedula_formato_invalido");

  // Regla 2.3 — Apoderado colapsado con RL del banco.
  const normCed = (c: string | undefined) => (c ? c.replace(/[.\s-]/g, "") : "");
  const nRl = normCed(rlCedula);
  const nApPlano = normCed(apoderadoCedulaPlano);
  const nApDeep = normCed(apoderadoCedulaDeep);
  if (nRl && (nRl === nApPlano || nRl === nApDeep)) {
    warnings.push("apoderado_coincide_con_rl_banco");
    suspicious.add("apoderado_cedula");
    suspicious.add("apoderado.cedula");
    suspicious.add("poderdante.representante_legal_cedula");
  }

  return { warnings, suspicious };
}
