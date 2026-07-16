// ============================================================================
// certificadoInmuebleValidate.ts — Coherencia intra-documento del bloque
// `inmueble` extraído del Certificado de Tradición y Libertad.
//
// Detecta transposiciones de dígitos y ruido de OCR en dirección catastral
// y número de matrícula inmobiliaria comparando MÚLTIPLES menciones
// independientes emitidas por el modelo. Análogo a `validatePoderBancoCoherencia`
// Regla 5 (menciones_rl del RL del banco). Caso ancla real: escritura 7058,
// matrícula 50C-1572091, dirección "KR 104 13C-05 CA 119" leída como "13C-09"
// en al menos una corrida.
//
// 🛡️ PUREZA: solo TS. Isomórfico (edge + client). Sin fetch, sin Deno.
// Nunca lanza; devuelve `{warnings, suspicious}`.
//
// Los warnings terminan en `_menciones_incoherentes` para engancharse
// automáticamente al hard-block existente vía `isHardBlockCoherenciaWarning`
// (reutiliza `HARD_BLOCK_WARNING_SUFFIXES` de poderBancoExtractor/validate.ts).
// ============================================================================

const NULLY_MENCION = new Set(["", "NO_LEGIBLE", "N/A", "NULL", "UNDEFINED"]);

/** Normalización de dirección para COMPARACIÓN (no para render).
 *  Reutiliza el mismo espíritu de `sanitizeNomenclaturaBase` (Fase A del skill
 *  direccion-completa-saneada-cancelacion): strip catastral, strip ciudad,
 *  "GUION" → "-", uppercase, colapso de espacios y de separadores no
 *  significativos. NO añade el sufijo notarial. */
export function normalizeDireccionForCompare(s: string): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/\(?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*\)?/gi, "")
    .replace(/\s+DE\s+LA\s+CIUDAD\s+Y\/?O\s+MUNICIPIO\s+DE\s+.+$/i, "")
    .replace(/\s+GUION(?:ES)?\s+/gi, " - ")
    .replace(/[.,]/g, " ")
    .replace(/[-\s]+/g, " ")
    .trim();
}

/** Matrícula normalizada para COMPARACIÓN: uppercase, sin espacios ni puntos
 *  ni guiones. El guion ASCII del código ORIP (50C-1572091) no es
 *  semánticamente significativo para detectar transposición de dígitos: lo
 *  colapsamos para no reportar falsos positivos por formato. */
export function normalizeMatriculaForCompare(s: string): string {
  return (s ?? "").toUpperCase().replace(/[.\s-]/g, "").trim();
}

export interface InmuebleCoherenciaResult {
  warnings: string[];
  suspicious: Set<string>;
}

/** Ejecuta las 2 reglas de coherencia intra-documento sobre la sección
 *  `inmueble` mergeada. */
export function validateInmuebleCoherencia(
  inmueble: Record<string, unknown> | null | undefined,
): InmuebleCoherenciaResult {
  const warnings: string[] = [];
  const suspicious = new Set<string>();
  if (!inmueble || typeof inmueble !== "object") return { warnings, suspicious };

  // Regla 1 — Dirección catastral: ≥2 menciones distintas tras normalizar.
  const mDir = (inmueble.menciones_direccion ?? []) as Array<Record<string, unknown>>;
  if (Array.isArray(mDir) && mDir.length >= 2) {
    const vals = mDir
      .map((m) => String(m?.valor ?? "").trim())
      .filter((v) => v && !NULLY_MENCION.has(v.toUpperCase()))
      .map(normalizeDireccionForCompare)
      .filter((v) => v);
    if (new Set(vals).size >= 2) {
      warnings.push("inmueble_direccion_menciones_incoherentes");
      suspicious.add("inmueble.menciones_direccion");
      suspicious.add("inmueble.nomenclatura_predio");
    }
  }

  // Regla 2 — Matrícula inmobiliaria: ≥2 menciones distintas tras normalizar.
  const mMat = (inmueble.menciones_matricula ?? []) as Array<Record<string, unknown>>;
  if (Array.isArray(mMat) && mMat.length >= 2) {
    const vals = mMat
      .map((m) => String(m?.valor ?? "").trim())
      .filter((v) => v && !NULLY_MENCION.has(v.toUpperCase()))
      .map(normalizeMatriculaForCompare)
      .filter((v) => v);
    if (new Set(vals).size >= 2) {
      warnings.push("inmueble_matricula_menciones_incoherentes");
      suspicious.add("inmueble.menciones_matricula");
      suspicious.add("inmueble.matricula_inmobiliaria");
    }
  }

  return { warnings, suspicious };
}
