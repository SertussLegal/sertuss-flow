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

/** Normaliza una cédula/NIT quitando puntos, espacios y guiones — retorna
 *  solo dígitos o cadena vacía. Fuente única para comparaciones de identidad
 *  a lo largo del extractor (validate + crossCheck). */
export function normalizeCedula(c: string | undefined | null): string {
  if (!c || typeof c !== "string") return "";
  return c.replace(/[.\s-]/g, "").replace(/\D/g, "");
}

/** Cédulas "placeholder" observadas empíricamente como alucinaciones
 *  recurrentes del OCR (patrones tipo "79.123.456"). Se comparan tras
 *  normalizar (`normalizeCedula`). Ampliable sin migración — mantener
 *  ordenado y con comentario del caso que motivó la inclusión. */
export const PODER_CEDULAS_PLACEHOLDER: ReadonlySet<string> = new Set([
  "79123456", // 5 cancelaciones con nombres distintos (auditoría 2026-07-08).
  // NOTA: 41939243 fue removido (2026-07-08) — es cédula real confirmada del
  // caso Armenia (Ana María Montoya Echeverry), no un placeholder alucinado.
]);

/** Detecta el centinela textual "NO_LEGIBLE" emitido por el OCR cuando el
 *  campo aparece en el documento pero no se puede leer con certeza. */
export function isNoLegible(v: unknown): boolean {
  return typeof v === "string" && v.trim() === "NO_LEGIBLE";
}

/** Sufijos de warning que deben forzar `revision_manual_requerida = true`.
 *  Fuente única de verdad — consumida por el edge (Fase E) y por la UI
 *  (broadening del CTA de "Confirmar revisión manual"). */
export const HARD_BLOCK_WARNING_SUFFIXES = [
  "_no_legible",
  "_incoherente",
  "_placeholder",
  "_duplicidad_cruzada",
  "_menciones_incoherentes",
] as const;

export function isHardBlockCoherenciaWarning(w: string | undefined | null): boolean {
  if (!w || typeof w !== "string") return false;
  return HARD_BLOCK_WARNING_SUFFIXES.some((suf) => w.endsWith(suf));
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
  apoderado_cedula_placeholder:
    "La cédula del apoderado coincide con un patrón placeholder conocido (alucinación recurrente del OCR) — verifica contra el documento original",
  apoderado_nombre_duplicidad_cruzada:
    "Este nombre de apoderado ya aparece en otra cancelación con una cédula distinta — probable alucinación cruzada, requiere verificación manual",
  apoderado_cedula_duplicidad_cruzada:
    "Esta cédula ya está asociada a un nombre de apoderado distinto en otra cancelación — probable alucinación cruzada, requiere verificación manual",
  rl_banco_menciones_incoherentes:
    "Las menciones del representante legal del banco dentro del mismo documento no coinciden entre sí (posible transposición de dígitos) — verifica manualmente contra el PDF original.",
};

/** Labels humanos por path de campo sospechoso. Consumidos por la UI para
 *  marcar el input correspondiente. */
export const SUSPICIOUS_FIELD_LABELS: Record<string, string> = {
  "apoderado_escritura": "Número de escritura (plano)",
  "instrumento_poder.escritura_num": "Número de escritura (detalle profundo)",
  "escritura_poder_num": "Número de escritura (plano legacy)",
  "apoderado_fecha": "Fecha del poder (plano)",
  "instrumento_poder.fecha": "Fecha del poder (detalle profundo)",
  "instrumento_poder.fecha_texto": "Fecha del poder (texto literal)",
  "fecha_poder": "Fecha del poder (plano legacy)",
  "apoderado_cedula": "Cédula del apoderado (plano)",
  "apoderado.cedula": "Cédula del apoderado (detalle profundo)",
  "apoderado_nombre": "Nombre del apoderado (plano)",
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

  // Regla 3 — Campos críticos marcados como NO_LEGIBLE por el OCR (v7-2026-07-08).
  // Cuando el modelo declara honestamente que no puede leer un campo, marcamos
  // warning explícito para que la UI pida verificación humana en vez de dejar
  // pasar un valor alucinado con apariencia de certeza.
  const escrituraPlanoLegacy = merged.escritura_poder_num as string | undefined;
  const fechaPlanoLegacy = merged.fecha_poder as string | undefined;
  const instrFechaTexto = instr?.fecha_texto as string | undefined;

  const noLegibleChecks: Array<[string, Array<[string, unknown]>]> = [
    ["apoderado_cedula_no_legible", [
      ["apoderado_cedula", apoderadoCedulaPlano],
      ["apoderado.cedula", apoderadoCedulaDeep],
    ]],
    ["escritura_poder_no_legible", [
      ["escritura_poder_num", escrituraPlanoLegacy],
      ["apoderado_escritura", apoderadoEscritura],
      ["instrumento_poder.escritura_num", instrEscritura],
    ]],
    ["fecha_poder_no_legible", [
      ["fecha_poder", fechaPlanoLegacy],
      ["apoderado_fecha", apoderadoFecha],
      ["instrumento_poder.fecha", instrFecha],
      ["instrumento_poder.fecha_texto", instrFechaTexto],
    ]],
  ];
  for (const [warningCode, paths] of noLegibleChecks) {
    let triggered = false;
    for (const [path, val] of paths) {
      if (isNoLegible(val)) {
        suspicious.add(path);
        triggered = true;
      }
    }
    if (triggered) warnings.push(warningCode);
  }

  // Regla 4 — Cédula del apoderado coincide con un placeholder alucinado
  //           conocido (auditoría 2026-07-08).
  const cedulaCandidates: Array<[string, string | undefined]> = [
    ["apoderado_cedula", apoderadoCedulaPlano],
    ["apoderado.cedula", apoderadoCedulaDeep],
  ];
  let hitPlaceholder = false;
  for (const [path, val] of cedulaCandidates) {
    const norm = normalizeCedula(val);
    if (norm && PODER_CEDULAS_PLACEHOLDER.has(norm)) {
      suspicious.add(path);
      hitPlaceholder = true;
    }
  }
  if (hitPlaceholder) warnings.push("apoderado_cedula_placeholder");

  return { warnings, suspicious };
}
