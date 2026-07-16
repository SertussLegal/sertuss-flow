/**
 * Ensamblador determinista de nombre notarial colombiano.
 *
 * Regla: en escritura pública colombiana el orden correcto es
 * `NOMBRES APELLIDOS` (ej. "MARGARITA IBETH DIAZ GARCIA"), mientras que los
 * certificados de tradición usan formato registral `APELLIDOS NOMBRES`.
 *
 * Este helper concatena `nombres` + `apellidos` cuando el modelo los separó
 * correctamente, y cae al string `nombre` verbatim como fallback para
 * historicos (`data_ia`/`data_final` sin los campos nuevos) o corridas
 * donde el function-calling falló parcialmente.
 *
 * NO parsea ni adivina: si el modelo separó mal, el humano corrige el
 * string final en la UI (invalidando `apellidos`/`nombres` en ese momento).
 */
export interface DeudorNombreInput {
  nombre?: string | null;
  nombres?: string | null;
  apellidos?: string | null;
}

export function ensamblarNombreNotarial(d: DeudorNombreInput | null | undefined): string {
  const nombres = String(d?.nombres ?? "").toUpperCase().trim();
  const apellidos = String(d?.apellidos ?? "").toUpperCase().trim();
  if (nombres && apellidos) return `${nombres} ${apellidos}`;
  return String(d?.nombre ?? "").toUpperCase().trim();
}
