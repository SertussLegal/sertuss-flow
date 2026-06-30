// ============================================================================
// dateBogota — Normalización temporal con soberanía territorial Colombia.
// Plan v5, sección Q (corrige L2): elimina falsos positivos de expiración
// por desfase de zona horaria entre servidores US-East y notarías UTC-5.
//
// REGLA DE ORO: TODA comparación de vigencia de poderes debe pasar por
// `toLocalDateBogota()` ANTES de aplicar `<` o `>`. La salida es un string
// "YYYY-MM-DD" cuyo orden lexicográfico === orden cronológico.
// ============================================================================

/**
 * Convierte cualquier input de fecha a string "YYYY-MM-DD" en la zona
 * horaria de Bogotá (UTC-5). Acepta:
 *   - Date nativo
 *   - ISO string ("2026-07-15T00:00:00Z")
 *   - "YYYY-MM-DD" plano (se respeta tal cual, sin re-interpretar TZ)
 *   - Cualquier string parseable por `new Date(...)`
 *
 * @example
 *   toLocalDateBogota("2026-07-15")                 // → "2026-07-15"
 *   toLocalDateBogota("2026-07-15T03:00:00.000Z")   // → "2026-07-14" en Bogotá
 *   toLocalDateBogota(new Date())                    // → fecha hoy en Bogotá
 */
export function toLocalDateBogota(input: string | Date | null | undefined): string {
  if (input == null) return "";
  if (typeof input === "string") {
    // Atajo: si ya es "YYYY-MM-DD" puro, no introducimos riesgo de TZ.
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = typeof input === "string" ? new Date(input) : input;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";

  // Intl.DateTimeFormat con timeZone="America/Bogota" devuelve los componentes
  // tal como los vería un notario en Colombia, independientemente de dónde
  // corre el servidor (Lovable Cloud, Deno Deploy, regions US, etc.).
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // "en-CA" entrega exactamente "YYYY-MM-DD".
  return fmt.format(d);
}

/**
 * Suma `n` días (enteros) a una fecha y la devuelve normalizada a Bogotá.
 * Útil para "estimar" la fecha de otorgamiento cuando el usuario aún no fijó
 * la cita notarial real (fallback conservador del validador de vigencia).
 */
export function addDaysBogota(input: string | Date, n: number): string {
  const base = typeof input === "string" ? new Date(input) : new Date(input);
  base.setUTCDate(base.getUTCDate() + n);
  return toLocalDateBogota(base);
}

/**
 * Años transcurridos entre dos fechas "YYYY-MM-DD" puras.
 * Devuelve un número fraccional con 2 decimales de precisión.
 *
 * IMPORTANTE: ambas entradas deben venir YA normalizadas por
 * `toLocalDateBogota()`. Esta función NO re-normaliza para mantener
 * la responsabilidad única.
 */
export function yearsBetweenIsoDates(fromIso: string, toIso: string): number {
  if (!fromIso || !toIso) return 0;
  const f = parseIsoDateUTC(fromIso);
  const t = parseIsoDateUTC(toIso);
  if (!f || !t) return 0;
  const diffMs = t.getTime() - f.getTime();
  const years = diffMs / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(years * 100) / 100;
}

/**
 * Parsea "YYYY-MM-DD" como medianoche UTC. Solo para aritmética interna
 * de `yearsBetweenIsoDates` — los strings ya vienen normalizados a Bogotá
 * por `toLocalDateBogota()`, así que tratarlos como UTC al recalcular
 * diferencias es matemáticamente correcto (ambos lados con misma base).
 */
function parseIsoDateUTC(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}
