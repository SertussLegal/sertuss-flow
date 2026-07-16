// ============================================================================
// direccionCandidatasSelect.ts — Selección DETERMINISTA de la nomenclatura
// vigente entre los renglones numerados del bloque "DIRECCION DEL INMUEBLE"
// del Certificado de Tradición y Libertad.
//
// Regla notarial: la nomenclatura vigente es la del renglón de ÍNDICE MÁS
// ALTO ('1)', '2)', '3)'… o romano I, II, III…). Antes esta selección la
// hacía Gemini en el prompt — antipatrón `blindaje-anti-transposicion-ocr`
// §7 (no le pidas al modelo que audite su propia alucinación). Ahora el
// código cuenta y compara: el modelo transcribe TODOS los candidatos, el
// código elige el ganador.
//
// COEXISTENCIA con `menciones_direccion[]` (Regla 1 de
// `certificadoInmuebleValidate.ts`): son ORTOGONALES.
//   - `direccion_candidatas` → selección entre hechos LEGÍTIMAMENTE distintos
//     (renumeración catastral). Compara por índice, elige la del mayor.
//   - `menciones_direccion` → ruido OCR sobre el MISMO hecho (transposición
//     de dígitos en repeticiones de la MISMA dirección en varias secciones).
//     Compara por igualdad tras normalizar, dispara si difieren.
// Este módulo opera ANTES; el otro sigue operando DESPUÉS sobre el ganador.
//
// 🛡️ PUREZA: solo TS. Isomórfico (edge + client). Sin fetch, sin Deno.
// Nunca lanza; devuelve `{seleccionada, warnings, suspicious, …}`.
//
// El warning `direccion_indice_corregido_por_codigo` NO termina en
// `_menciones_incoherentes`, así que por diseño NO engancha
// `HARD_BLOCK_WARNING_SUFFIXES`. Es informativo/ámbar, no bloqueante.
// ============================================================================

export type DireccionCandidata = { indice: string; valor: string };

export interface SelectDireccionResult {
  /** Valor del candidato ganador ya formateado en notarial TEXTO (NÚMERO)
   *  (lo emite el modelo así). `undefined` si no hubo candidatas válidas. */
  seleccionada: string | undefined;
  /** Índice numérico normalizado del ganador (arábigo o romano convertido). */
  indiceGanador: number | undefined;
  /** true si la `nomenclatura_predio` que el modelo eligió por su cuenta
   *  difiere (tras normalizar) de la seleccionada por el código. */
  divergeDelModelo: boolean;
  /** Warnings a acumular en `_coherencia_warnings`. */
  warnings: string[];
  /** Rutas de campos a marcar como sospechosos en la UI. */
  suspicious: Set<string>;
}

const NULLY_MENCION = new Set(["", "NO_LEGIBLE", "N/A", "NULL", "UNDEFINED"]);

const ROMAN_MAP: Record<string, number> = {
  I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
};

/** Parsea un índice arábigo (`"1".."99"`) o romano (`I..XX` case-insensitive,
 *  hasta XXXIX / 39 en la práctica notarial es más que suficiente).
 *  Retorna `null` si no matchea — el candidato se descarta silenciosamente. */
export function parseIndice(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[).\s]+$/g, "");
  if (!s) return null;
  // Arábigo puro
  if (/^\d{1,2}$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1 && n <= 99 ? n : null;
  }
  // Romano — validación estricta: solo letras romanas, resultado en rango.
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const v = ROMAN_MAP[s[i]!]!;
    if (v < prev) total -= v;
    else total += v;
    prev = v;
  }
  return total >= 1 && total <= 99 ? total : null;
}

/** Normalización para COMPARACIÓN entre la selección del código y la
 *  `nomenclatura_predio` que el modelo ya había emitido. Tolera:
 *    - `(DIRECCION CATASTRAL)` extra
 *    - coletilla `DE LA CIUDAD Y/O MUNICIPIO DE …`
 *    - `"GUION"` verbalizado como palabra suelta
 *    - variaciones de espaciado / puntuación cosmética
 *  NO fuzzy. `13C-05` vs `13C-09` DEBE divergir.
 *  (Regla dorada del skill blindaje-anti-transposicion-ocr §4.) */
export function normalizeForCompare(s: string | undefined | null): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/\(?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*\)?/gi, "")
    .replace(/\s+DE\s+LA\s+CIUDAD\s+Y[\s\/]*O\s+MUNICIPIO(?:\s+DE\s+.+)?$/i, "")
    .replace(/\s+GUION(?:ES)?\s+/gi, " - ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Selector determinista. Consume `direccion_candidatas[]` tal como lo emite
 *  Gemini (ver schema en `procesar-cancelacion/index.ts`, campo
 *  `inmueble.direccion_candidatas`) y devuelve la ganadora + evidencia. */
export function selectDireccionPorIndice(
  candidatas: DireccionCandidata[] | undefined | null,
  nomenclaturaModelo: string | undefined | null,
): SelectDireccionResult {
  const warnings: string[] = [];
  const suspicious = new Set<string>();

  const empty: SelectDireccionResult = {
    seleccionada: undefined,
    indiceGanador: undefined,
    divergeDelModelo: false,
    warnings,
    suspicious,
  };

  if (!Array.isArray(candidatas) || candidatas.length === 0) return empty;

  // Filtrar candidatas válidas (índice parseable + valor no-nully).
  // Preservar orden original — el tie-break necesita "última aparición".
  const validas: Array<{ idx: number; valor: string; pos: number }> = [];
  candidatas.forEach((c, pos) => {
    if (!c || typeof c !== "object") return;
    const idx = parseIndice(c.indice);
    if (idx == null) return;
    const valor = String(c.valor ?? "").trim();
    if (!valor) return;
    if (NULLY_MENCION.has(valor.toUpperCase())) return;
    validas.push({ idx, valor, pos });
  });

  if (validas.length === 0) return empty;

  // Ordenar: índice descendente. Empate → última aparición gana (pos mayor).
  // Justificación: el orden de emisión del modelo preserva el orden textual
  // del documento; el renglón que aparece más abajo es el más reciente en el
  // flujo de anotaciones catastrales.
  validas.sort((a, b) => (b.idx - a.idx) || (b.pos - a.pos));
  const ganador = validas[0]!;

  const seleccionada = ganador.valor;

  const modeloNorm = normalizeForCompare(nomenclaturaModelo);
  const selNorm = normalizeForCompare(seleccionada);
  const divergeDelModelo =
    !!modeloNorm && !!selNorm && modeloNorm !== selNorm;

  if (divergeDelModelo) {
    warnings.push("direccion_indice_corregido_por_codigo");
    suspicious.add("inmueble.nomenclatura_predio");
    suspicious.add("inmueble.direccion_candidatas");
  }

  return {
    seleccionada,
    indiceGanador: ganador.idx,
    divergeDelModelo,
    warnings,
    suspicious,
  };
}
