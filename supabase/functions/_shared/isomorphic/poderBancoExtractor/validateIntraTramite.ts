// ============================================================================
// poderBancoExtractor/validateIntraTramite.ts — Fase 2: coherencia intra-trámite
//
// Valida que el `poder_banco.poderdante` (banco que otorga el poder)
// corresponda al mismo banco que aparece como acreedor hipotecario en la
// escritura antecedente / certificado de tradición del MISMO trámite.
//
// Dos reglas HARD_BLOCK (sufijo `_incoherente`, ya en HARD_BLOCK_WARNING_SUFFIXES):
//   1. poder_entidad_nit_incoherente — NIT vs NIT (primaria, evidencia fuerte).
//   2. poder_entidad_nombre_incoherente — nombre fuzzy (SOLO si falta un NIT).
//
// 🛡️ PUREZA: solo TS. Isomórfico (edge + client). Sin fetch, sin Deno.
// ============================================================================

export interface PartesForCoherencia {
  banco_nit?: string | null;
  banco_acreedor?: string | null;
}

export interface IntraTramiteResult {
  warnings: string[];
  suspicious: Set<string>;
}

/** Normaliza NIT a solo dígitos. Idéntico patrón al de prosaBancos/index.ts,
 *  con `.replace(/\D/g, "")` extra por defensa. Aceptable duplicación
 *  (una línea, pura, sin dependencias). */
function normalizeNit(nit: string | null | undefined): string {
  if (!nit || typeof nit !== "string") return "";
  return nit.replace(/[.\s\-]/g, "").replace(/\D/g, "");
}

/** Normaliza nombre de banco para fuzzy match. Portado desde
 *  src/lib/bankDirectory.ts:37 (que NO es importable desde edge functions
 *  por vivir fuera de _shared/isomorphic/). Quita acentos, mayúsculas,
 *  sufijos comerciales (S.A./S.A.S/LTDA/E.U.) y colapsa espacios. */
function normalizeBankName(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  let n = raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  n = n.replace(/\b(S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|E\.?U\.?)\b\.?/g, "");
  n = n.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  return n;
}

/** Chequeo intra-trámite: poder ↔ acreedor real de la escritura/certificado.
 *  Nunca lanza. Devuelve warnings vacíos si no hay señales o si faltan datos
 *  suficientes para evaluar. */
export function validatePoderVsCancelacion(
  merged: Record<string, unknown> | null | undefined,
  partes: PartesForCoherencia | null | undefined,
): IntraTramiteResult {
  const warnings: string[] = [];
  const suspicious = new Set<string>();
  if (!merged || typeof merged !== "object") return { warnings, suspicious };
  if (!partes || typeof partes !== "object") return { warnings, suspicious };

  const poderdante = (merged.poderdante ?? null) as Record<string, unknown> | null;
  if (!poderdante) return { warnings, suspicious };

  const poderdanteNit = poderdante.entidad_nit as string | null | undefined;
  const poderdanteNom = poderdante.entidad_nombre as string | null | undefined;
  const acreedorNit = partes.banco_nit;
  const acreedorNom = partes.banco_acreedor;

  const nNitPoder = normalizeNit(poderdanteNit);
  const nNitAcreedor = normalizeNit(acreedorNit);

  // Regla 1 — primaria: NIT vs NIT.
  // Cuando ambos NITs están presentes, es la única señal que se evalúa:
  // si coinciden, cualquier desalineamiento textual del nombre es OCR ruido
  // ("DAVIVIENDA" vs "BANCO DAVIVIENDA S.A."), no incoherencia real.
  if (nNitPoder && nNitAcreedor) {
    if (nNitPoder !== nNitAcreedor) {
      warnings.push("poder_entidad_nit_incoherente");
      suspicious.add("poderdante.entidad_nit");
      suspicious.add("partes.banco_nit");
    }
    return { warnings, suspicious };
  }

  // Regla 2 — respaldo: nombre fuzzy, SOLO si falta al menos un NIT.
  // Contención bidireccional sobre nombres normalizados (mismo criterio
  // que src/lib/bankDirectory.ts:64-70). Suficiente y determinista.
  if (poderdanteNom && acreedorNom) {
    const nA = normalizeBankName(poderdanteNom);
    const nB = normalizeBankName(acreedorNom);
    if (nA && nB) {
      const match = nA === nB || nA.includes(nB) || nB.includes(nA);
      if (!match) {
        warnings.push("poder_entidad_nombre_incoherente");
        suspicious.add("poderdante.entidad_nombre");
        suspicious.add("partes.banco_acreedor");
      }
    }
  }

  return { warnings, suspicious };
}
