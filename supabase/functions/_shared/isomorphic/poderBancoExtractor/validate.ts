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

/** Normaliza un nombre de firmante para AGRUPAR menciones de la MISMA persona
 *  antes de compararlas. Determinista, sin fuzzy match:
 *   - uppercase
 *   - strip de tildes
 *   - strip de coletillas de cargo comunes (", SUPLENTE", "(PRIMER SUPLENTE)",
 *     "- REPRESENTANTE LEGAL")
 *   - colapso de espacios
 *  Devuelve cadena vacía si el input es vacío/nully — el llamador filtra.
 *  Nunca colapsa iniciales ni acorta nombres: transposición de nombre entre
 *  firmantes distintos (Lina vs Kleitman) NUNCA debe unificarse. */
export function normalizeNombreFirmante(raw: unknown): string {
  if (raw == null) return "";
  const s = typeof raw === "string" ? raw : String(raw);
  const stripped = s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // tildes
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")                       // coletillas entre paréntesis
    .replace(/[,\-–]\s*(PRIMER |SEGUNDO |TERCER )?SUPLENTE\b/g, " ")
    .replace(/[,\-–]\s*REPRESENTANTE LEGAL\b/g, " ")
    .replace(/[,\-–]\s*GERENTE\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  if (["", "NO_LEGIBLE", "N/A", "NULL", "UNDEFINED"].includes(stripped)) return "";
  return stripped;
}

/**
 * Clave de agrupación conmutativa respecto al orden de palabras: normaliza con
 * normalizeNombreFirmante (acentos/Ñ, coletillas de cargo, etc.) y luego ordena
 * alfabéticamente las palabras resultantes. Esto hace que "LUIS GABRIEL LOPEZ
 * URUENA" y "LOPEZ URUEÑA LUIS GABRIEL" (mismo nombre, distinto orden apellido/
 * nombre u OCR) agrupen igual, sin fusionar nombres de personas distintas
 * (conjuntos de palabras distintos siguen siendo distintos).
 * Bug real confirmado 2026-08-01: el mismo patrón de alucinación de cédula
 * (dígito inicial perdido) se detectó el 26-jul (nombres idénticos, agrupó
 * correctamente) pero pasó inadvertido el 29-jul (mismo dígito perdido, pero
 * nombres en orden distinto → grupos separados → sin comparación).
 */
function normalizeNombreGrupo(raw: unknown): string {
  const base = normalizeNombreFirmante(raw);
  if (!base) return base;
  return base.split(/\s+/).filter(Boolean).sort().join(" ");
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
  "_requiere_confirmacion",
  "_divergencia_lecturas",
  "_no_resuelto",
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
  poder_entidad_nit_incoherente:
    "El NIT del banco que otorga el poder no coincide con el NIT del acreedor hipotecario extraído de la escritura/certificado — el poder podría no aplicar a esta cancelación.",
  poder_entidad_nombre_incoherente:
    "El nombre del banco que otorga el poder no coincide con el acreedor hipotecario extraído de la escritura/certificado — verifica que el poder corresponda a esta cancelación.",
  inmueble_direccion_menciones_incoherentes:
    "La dirección catastral se lee distinta en ≥2 secciones del mismo certificado (posible transposición de dígitos) — verifica manualmente contra el PDF original antes de firmar.",
  inmueble_matricula_menciones_incoherentes:
    "El número de matrícula inmobiliaria aparece distinto en ≥2 secciones del mismo certificado — verifica manualmente contra el PDF original antes de firmar.",
  direccion_indice_corregido_por_codigo:
    "El certificado tiene varias direcciones numeradas. El sistema seleccionó la de índice más alto; verifica que sea la vigente contra el PDF.",
  apoderado_cedula_menciones_incoherentes:
    "La cédula del apoderado se lee distinta en ≥2 secciones del mismo poder (posible transposición de dígitos o atribución cruzada entre firmantes) — verifica manualmente contra el PDF original antes de firmar.",
  apoderado_cedula_confianza_baja:
    "El OCR reportó confianza baja al leer la cédula del apoderado — verifícala manualmente contra el PDF original antes de firmar.",
  poderdante_rl_cedula_confianza_baja:
    "El OCR reportó confianza baja al leer la cédula del representante legal del banco — verifícala manualmente contra el PDF original antes de firmar.",
  escritura_poder_confianza_baja:
    "El OCR reportó confianza baja al leer el número de escritura del poder — verifícalo manualmente contra el PDF original antes de firmar.",
  fecha_poder_confianza_baja:
    "El OCR reportó confianza baja al leer la fecha del poder — verifícala manualmente contra el PDF original antes de firmar.",
  apoderado_nombre_divergencia_plano_anidado:
    "El nombre del apoderado que corregiste no coincidía con el que se iba a usar en la redacción de la comparecencia/antefirma — se usó tu corrección en todo el documento.",
  apoderado_cedula_divergencia_plano_anidado:
    "La cédula del apoderado que corregiste no coincidía con la que se iba a usar en la redacción de la comparecencia/antefirma — se usó tu corrección en todo el documento.",
  apoderado_multiple_firmantes_ambiguo:
    "El poder tiene más de un firmante marcado — se usó el primero. Verifica que corresponda al que efectivamente firma.",
  apoderado_cedula_divergencia_lecturas:
    "Las dos lecturas independientes del Poder leyeron cédulas distintas para el apoderado — verifícala manualmente contra el PDF original antes de firmar.",
  escritura_poder_divergencia_lecturas:
    "Las dos lecturas independientes del Poder leyeron números de escritura distintos — verifícalo manualmente contra el PDF original antes de firmar.",
  fecha_poder_divergencia_lecturas:
    "Las dos lecturas independientes del Poder leyeron fechas distintas para el poder — verifícala manualmente contra el PDF original antes de firmar.",
  apoderado_natural_candidatos_requiere_confirmacion:
    "El Poder nombra a varias personas como posibles apoderados — confirma con el banco cuál actuó en este trámite y selecciónala antes de continuar.",
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
  "poderdante.menciones_rl": "Menciones del representante legal del banco",
  "poderdante.entidad_nit": "NIT del banco que otorga el poder",
  "poderdante.entidad_nombre": "Nombre del banco que otorga el poder",
  "partes.banco_nit": "NIT del banco acreedor (escritura/certificado)",
  "partes.banco_acreedor": "Nombre del banco acreedor (escritura/certificado)",
  "inmueble.menciones_direccion": "Menciones de dirección catastral en el certificado",
  "inmueble.nomenclatura_predio": "Dirección catastral (nomenclatura del predio)",
  "inmueble.menciones_matricula": "Menciones de matrícula inmobiliaria en el certificado",
  "inmueble.matricula_inmobiliaria": "Matrícula inmobiliaria",
  "apoderado.menciones_cedula": "Menciones de la cédula del apoderado en el poder",
  "apoderado.candidatos_natural": "Lista de posibles apoderados nombrados en el Poder",
};


export interface CoherenciaResult {
  warnings: string[];
  suspicious: Set<string>;
}

/** Opciones de contexto. `manualReviewConfirmed` refleja que el operador
 *  humano ya confirmó revisión manual (`cancelaciones.revision_manual_confirmada_at`
 *  no nulo) y por lo tanto la señal Manual > OCR aplica: si además corrigió
 *  la cédula escalar del RL del banco a un valor con formato válido, la
 *  incoherencia intra-documento de `menciones_rl[]` (Regla 5) deja de ser
 *  bloqueante — `menciones_rl` se preserva íntegro como evidencia forense,
 *  pero no se emite el warning que dispara el hard-block. */
export interface CoherenciaOpts {
  manualReviewConfirmed?: boolean;
}

/** Ejecuta las 4 reglas de coherencia sobre un payload `poder_banco` ya
 *  mergeado. Nunca lanza; devuelve resultado vacío si no hay señales. */
export function validatePoderBancoCoherencia(
  merged: Record<string, unknown> | null | undefined,
  opts?: CoherenciaOpts,
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

  // Regla 5 — Coherencia intra-documento del RL del banco (Fase 1 anti-transposición).
  // Compara las cédulas normalizadas de todas las menciones independientes del
  // RL leídas en distintas secciones del MISMO PDF. Si ≥2 difieren, warning +
  // suspicious. Caso real que motivó la regla: 79392406 vs 79382406.
  //
  // Excepción "Manual > OCR > BD" (2026-07-16): cuando el operador ya
  // confirmó revisión manual (opts.manualReviewConfirmed) Y corrigió la cédula
  // escalar del RL a un valor con formato válido, la incoherencia entre
  // menciones deja de ser bloqueante — el humano ya arbitró. `menciones_rl`
  // no se toca: se preserva íntegro como evidencia forense en `data_final`.
  const menciones = (poderdante?.menciones_rl ?? []) as Array<Record<string, unknown>>;
  if (Array.isArray(menciones) && menciones.length >= 2) {
    const cedulasNorm = menciones
      .map((m) => {
        const raw = m?.cedula as string | undefined;
        if (isNoLegible(raw)) return ""; // NO_LEGIBLE no cuenta como discrepancia
        return normalizeCedula(raw);
      })
      .filter((c) => c);
    const distintas = new Set(cedulasNorm);
    if (distintas.size >= 2) {
      const humanArbitrated =
        opts?.manualReviewConfirmed === true &&
        typeof rlCedula === "string" &&
        isCedulaValida(rlCedula) &&
        normalizeCedula(rlCedula).length > 0;
      if (!humanArbitrated) {
        warnings.push("rl_banco_menciones_incoherentes");
        suspicious.add("poderdante.menciones_rl");
        suspicious.add("poderdante.representante_legal_cedula");
      }
    }
  }

  // Regla 6 — Coherencia intra-documento de la cédula del apoderado
  //           (Fase 3ª anti-transposición, skill blindaje-anti-transposicion-ocr).
  //
  // A diferencia de Regla 5 (RL del banco, un solo firmante), un poder puede
  // designar VARIOS firmantes: RL principal + suplente(s). Comparar todas las
  // menciones en un set plano produciría falsos positivos legítimos (Lina vs
  // Kleitman). Por eso agrupamos por NOMBRE normalizado y comparamos solo
  // dentro de cada grupo. Nombres vacíos/no legibles se descartan del set.
  //
  // Excepción "Manual > OCR": si el operador ya confirmó revisión manual y
  // dejó la cédula escalar del apoderado en formato válido (natural:
  // apoderado.cedula; juridica: todas las representantes[].cedula), el
  // warning se suprime — la evidencia forense `menciones_cedula` se
  // preserva íntegra.
  const mAp = (apoderado?.menciones_cedula ?? []) as Array<Record<string, unknown>>;
  if (Array.isArray(mAp) && mAp.length >= 2) {
    const groups = new Map<string, Set<string>>();
    for (const m of mAp) {
      const nom = normalizeNombreGrupo(m?.nombre);
      if (!nom) continue;
      const raw = m?.cedula as string | undefined;
      if (isNoLegible(raw)) continue;
      const ced = normalizeCedula(raw);
      if (!ced) continue;
      if (!groups.has(nom)) groups.set(nom, new Set());
      groups.get(nom)!.add(ced);
    }
    const inconsistente = Array.from(groups.values()).some((s) => s.size >= 2);
    if (inconsistente) {
      const tipoAp = apoderado?.tipo as string | undefined;
      const escalaresValidos = (() => {
        if (tipoAp === "juridica") {
          if (!Array.isArray(representantes) || representantes.length === 0) return false;
          return representantes.every((rep) => {
            const c = rep?.cedula as string | undefined;
            return isCedulaValida(c) && normalizeCedula(c).length > 0;
          });
        }
        // natural o desconocido → validar escalar plano/profundo.
        const anyValid = [apoderadoCedulaPlano, apoderadoCedulaDeep].some(
          (c) => isCedulaValida(c) && normalizeCedula(c).length > 0,
        );
        return anyValid;
      })();
      const humanArbitrated =
        opts?.manualReviewConfirmed === true && escalaresValidos;
      if (!humanArbitrated) {
        warnings.push("apoderado_cedula_menciones_incoherentes");
        suspicious.add("apoderado.menciones_cedula");
        suspicious.add("apoderado.cedula");
        suspicious.add("apoderado_cedula");
      }
    }
  }
  // Regla 7 — Confianza baja reportada por Gemini en 4 campos críticos
  //           (v7-2026-07, skill blindaje-anti-transposicion-ocr fase 4ª).
  //
  // Detecta "alucinación confiada": el modelo lee un valor consistente entre
  // menciones (Reglas 5/6 no disparan) pero marca `confianza=baja`. Vive en
  // el sidecar `_confianza` que `mergePoderBancoV6` emite — se recalcula por
  // corrida OCR, no se persiste como fuente de verdad. Registros históricos
  // sin sidecar → no dispara.
  //
  // Advertencia ámbar, NUNCA hard-block (sufijo `_confianza_baja` no coincide
  // con `HARD_BLOCK_WARNING_SUFFIXES`). Excepción Manual>OCR idéntica al resto:
  // si el humano confirmó revisión y el escalar tiene formato válido, suprime
  // el warning — el sidecar se preserva como evidencia forense.
  const confianzaMap = (merged._confianza ?? {}) as Record<string, unknown>;
  const escrituraPlanoLegacy2 = merged.escritura_poder_num as string | undefined;
  const fechaPlanoLegacy2 = merged.fecha_poder as string | undefined;

  type ConfCheck = {
    warning: string;
    path: string;
    valor: unknown;
    validFormat: (v: string) => boolean;
  };
  const confChecks: ConfCheck[] = [
    {
      warning: "apoderado_cedula_confianza_baja",
      path: "apoderado.cedula",
      valor: apoderadoCedulaDeep ?? apoderadoCedulaPlano,
      validFormat: (v) => isCedulaValida(v) && normalizeCedula(v).length > 0,
    },
    {
      warning: "poderdante_rl_cedula_confianza_baja",
      path: "poderdante.representante_legal_cedula",
      valor: rlCedula,
      validFormat: (v) => isCedulaValida(v) && normalizeCedula(v).length > 0,
    },
    {
      warning: "escritura_poder_confianza_baja",
      path: "instrumento_poder.escritura_num",
      valor: instrEscritura ?? apoderadoEscritura ?? escrituraPlanoLegacy2,
      validFormat: (v) => !!extractEscrituraDigits(v),
    },
    {
      warning: "fecha_poder_confianza_baja",
      path: "instrumento_poder.fecha",
      valor: instrFecha ?? apoderadoFecha ?? fechaPlanoLegacy2,
      validFormat: (v) => !!extractYear(v),
    },
  ];
  for (const chk of confChecks) {
    if (confianzaMap[chk.path] !== "baja") continue;
    // No emitir warning si el escalar está vacío/ausente/NO_LEGIBLE (Regla 3
    // ya lo cubre) o si su valor no tiene forma real.
    if (typeof chk.valor !== "string") continue;
    const trimmed = chk.valor.trim();
    if (!trimmed) continue;
    if (isNoLegible(trimmed)) continue;
    // Excepción Manual>OCR: humano confirmó y el escalar tiene formato válido.
    const humanArbitrated =
      opts?.manualReviewConfirmed === true && chk.validFormat(trimmed);
    if (humanArbitrated) continue;
    warnings.push(chk.warning);
    suspicious.add(chk.path);
  }

  // Regla 8 — Apoderado natural con múltiples candidatos sin confirmar
  //           (hallazgo 2026-07-30). Cuando el Poder nombra a más de una
  //           persona natural posible en el bloque vigente, el sistema NO
  //           puede saber cuál actuó realmente — requiere confirmación
  //           explícita del tramitador (banner en UI). Se considera
  //           "confirmado" cuando `apoderado.candidato_confirmado_cedula`
  //           coincide con una cédula PRESENTE en `candidatos_natural`
  //           actual — así, si el documento se reprocesa y la lista de
  //           candidatos cambia, una confirmación vieja NUNCA suprime el
  //           warning silenciosamente; se re-activa sola.
  const candidatosNatural = (apoderado?.candidatos_natural ?? []) as Array<Record<string, unknown>>;
  const tipoApoderado = apoderado?.tipo as string | undefined;
  if (tipoApoderado === "natural" && Array.isArray(candidatosNatural) && candidatosNatural.length > 1) {
    const cedulaConfirmada = apoderado?.candidato_confirmado_cedula as string | undefined;
    const cedulaConfirmadaNorm = normalizeCedula(cedulaConfirmada);
    const siguePresente = !!cedulaConfirmadaNorm && candidatosNatural.some(
      (c) => normalizeCedula(c?.cedula as string | undefined) === cedulaConfirmadaNorm,
    );
    const humanArbitrated8 = opts?.manualReviewConfirmed === true && siguePresente;
    if (!humanArbitrated8) {
      warnings.push("apoderado_natural_candidatos_requiere_confirmacion");
      suspicious.add("apoderado.candidatos_natural");
      suspicious.add("apoderado_nombre");
      suspicious.add("apoderado_cedula");
    }
  }

  // Regla 9 — Divergencia entre las DOS lecturas independientes del mismo PDF
  //           (extractor dedicado vs extractor V6 profundo). Cierra el hueco
  //           C6: cuando el dato aparece UNA sola vez en el documento, las
  //           Reglas 5/6 no tienen menciones que comparar y la Regla 7 no
  //           dispara porque el modelo reporta confianza "alta" aun
  //           equivocándose. El sidecar `_divergencia_lecturas` lo emite
  //           `mergePoderBancoV6` ANTES de la precedencia `??`; ya viene
  //           normalizado y filtrado (formatos no entendidos y NO_LEGIBLE se
  //           omiten allí, nunca llegan aquí).
  //
  // Excepción Manual>OCR idéntica a Reglas 6/8: si el humano confirmó revisión
  // y el escalar final tiene formato válido, se suprime el warning — el
  // sidecar se preserva íntegro como evidencia forense.
  const divergenciaMap = (merged._divergencia_lecturas ?? {}) as Record<string, unknown>;
  const escrituraPlanoLegacy9 = merged.escritura_poder_num as string | undefined;
  const fechaPlanoLegacy9 = merged.fecha_poder as string | undefined;

  const divChecks: Array<{
    key: string;
    warning: string;
    paths: string[];
    valorFinal: unknown;
    validFormat: (v: string) => boolean;
  }> = [
    {
      key: "apoderado_cedula",
      warning: "apoderado_cedula_divergencia_lecturas",
      paths: ["apoderado_cedula", "apoderado.cedula"],
      valorFinal: apoderadoCedulaPlano ?? apoderadoCedulaDeep,
      validFormat: (v) => isCedulaValida(v) && normalizeCedula(v).length > 0,
    },
    {
      key: "escritura_poder_num",
      warning: "escritura_poder_divergencia_lecturas",
      paths: ["apoderado_escritura", "instrumento_poder.escritura_num"],
      valorFinal: apoderadoEscritura ?? instrEscritura ?? escrituraPlanoLegacy9,
      validFormat: (v) => !!extractEscrituraDigits(v),
    },
    {
      key: "fecha_poder",
      warning: "fecha_poder_divergencia_lecturas",
      paths: ["apoderado_fecha", "instrumento_poder.fecha"],
      valorFinal: apoderadoFecha ?? instrFecha ?? fechaPlanoLegacy9,
      validFormat: (v) => !!extractYear(v),
    },
  ];
  for (const chk of divChecks) {
    const entry = divergenciaMap[chk.key];
    if (!entry || typeof entry !== "object") continue;
    const valor = typeof chk.valorFinal === "string" ? chk.valorFinal.trim() : "";
    const humanArbitrated9 =
      opts?.manualReviewConfirmed === true &&
      !!valor &&
      !isNoLegible(valor) &&
      chk.validFormat(valor);
    if (humanArbitrated9) continue;
    warnings.push(chk.warning);
    for (const p of chk.paths) suspicious.add(p);
  }

  return { warnings, suspicious };
}
