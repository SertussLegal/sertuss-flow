// ============================================================================
// poderBancoExtractor/crossCheck.ts — Chequeo determinista de duplicidad
// cruzada entre cancelaciones de la MISMA organización.
//
// Motivación (auditoría 2026-07-08): el OCR produjo la misma cédula
// "79.123.456" asignada a 5 nombres distintos, y el mismo nombre
// "ANA MARIA MONTOYA ECHEVERRY" con 5 cédulas distintas. Estos patrones
// solo son detectables mirando el histórico — nunca los detecta un check
// interno de un solo poder.
//
// 🛡️ PUREZA: solo TS. Isomórfico (edge + client + vitest). Sin fetch,
// sin acceso directo a Supabase — el edge es quien carga `existing[]`.
// ============================================================================

import { normalizeCedula } from "./validate.ts";

/** Registro mínimo de una cancelación previa contra la cual comparamos.
 *  El edge extrae estos campos a partir de `data_ia.poder_banco` y
 *  `data_final.poder_banco` (unión — humano gana si difiere del OCR). */
export interface ExistingPoderRow {
  id: string;
  apoderado_nombre?: string | null;
  apoderado_cedula?: string | null;
}

export interface CurrentPoder {
  apoderado_nombre?: string | null;
  apoderado_cedula?: string | null;
}

export interface DuplicidadResult {
  warnings: string[];
  suspicious: Set<string>;
  /** Ids de cancelaciones previas que dispararon algún warning. Útil para
   *  system_events (auditoría rápida de qué fila se comparó). */
  matches: string[];
}

/** Normaliza un nombre para comparación: mayúsculas, sin acentos, colapsa
 *  espacios. La igualdad estricta post-normalización es intencional — dos
 *  nombres "diferentes" pero equivalentes no deben disparar el warning
 *  (ej. capitalización distinta). */
export function normalizeNombreApoderado(n: string | undefined | null): string {
  if (!n || typeof n !== "string") return "";
  return n
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Regla A + B: dado el poder actual y la lista de poderes previos en la
 *  misma organización, detecta:
 *   A) mismo nombre con cédula distinta (nombre reciclado / cédula inventada).
 *   B) misma cédula con nombre distinto (cédula reciclada / nombre inventado).
 *  NO detecta el placeholder puro (eso lo hace `validate.ts` → Regla 4). */
export function detectDuplicidadCruzada(
  current: CurrentPoder,
  existing: ReadonlyArray<ExistingPoderRow>,
): DuplicidadResult {
  const warnings: string[] = [];
  const suspicious = new Set<string>();
  const matches = new Set<string>();

  const curNombre = normalizeNombreApoderado(current.apoderado_nombre);
  const curCedula = normalizeCedula(current.apoderado_cedula);
  if (!curNombre && !curCedula) return { warnings, suspicious, matches: [] };

  let nombreHit = false;
  let cedulaHit = false;
  for (const row of existing) {
    const rowNombre = normalizeNombreApoderado(row.apoderado_nombre);
    const rowCedula = normalizeCedula(row.apoderado_cedula);
    // Regla A — mismo nombre, cédula distinta y no vacía en ambos lados.
    if (curNombre && rowNombre && curNombre === rowNombre && curCedula && rowCedula && curCedula !== rowCedula) {
      nombreHit = true;
      matches.add(row.id);
    }
    // Regla B — misma cédula, nombre distinto y no vacío en ambos lados.
    if (curCedula && rowCedula && curCedula === rowCedula && curNombre && rowNombre && curNombre !== rowNombre) {
      cedulaHit = true;
      matches.add(row.id);
    }
  }
  if (nombreHit) {
    warnings.push("apoderado_nombre_duplicidad_cruzada");
    suspicious.add("apoderado_nombre");
    suspicious.add("apoderado_cedula");
  }
  if (cedulaHit) {
    warnings.push("apoderado_cedula_duplicidad_cruzada");
    suspicious.add("apoderado_cedula");
    suspicious.add("apoderado_nombre");
  }
  return { warnings, suspicious, matches: Array.from(matches) };
}
