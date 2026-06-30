// ============================================================================
// poderVigenciaCliente — Versión frontend de la lógica de vigencia del
// Poder General. Espejo determinista de `validatePoderSuficiencia.ts` del
// backend, recortado a lo que la UI necesita para los banners K3/L3.
//
// Vive separado porque las edge functions corren Deno (.ts imports) y el
// cliente corre Vite/ESM. Cualquier cambio de regla aquí debe replicarse
// en `supabase/functions/_shared/validatePoderSuficiencia.ts`.
// ============================================================================

export function toLocalDateBogota(input: string | Date | null | undefined): string {
  if (input == null) return "";
  if (typeof input === "string") {
    const m = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = typeof input === "string" ? new Date(input) : input;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function addDaysBogota(input: string | Date, n: number): string {
  const base = typeof input === "string" ? new Date(input) : new Date(input);
  base.setUTCDate(base.getUTCDate() + n);
  return toLocalDateBogota(base);
}

export interface VigenciaInput {
  tipo?: "indefinida" | "hasta_fecha" | "hasta_terminacion_contrato" | null;
  fecha_limite?: string | null;
}

export interface VigenciaResult {
  estado: "vigente" | "expirado" | "atado_a_contrato" | "desconocido";
  fechaEval: string;
  fechaEstimada: boolean;
  fechaLimiteNormalizada?: string;
}

const DIAS_FALLBACK = 30;

export function evaluarVigenciaCliente(
  vig: VigenciaInput | null | undefined,
  fechaOtorgamientoProyectada?: string | Date | null,
): VigenciaResult {
  const fechaEstimada = !fechaOtorgamientoProyectada;
  const fechaEval = fechaOtorgamientoProyectada
    ? toLocalDateBogota(fechaOtorgamientoProyectada)
    : addDaysBogota(new Date(), DIAS_FALLBACK);

  if (!vig?.tipo) return { estado: "desconocido", fechaEval, fechaEstimada };

  if (vig.tipo === "hasta_fecha" && vig.fecha_limite) {
    const limite = toLocalDateBogota(vig.fecha_limite);
    if (limite && limite < fechaEval) {
      return { estado: "expirado", fechaEval, fechaEstimada, fechaLimiteNormalizada: limite };
    }
    return { estado: "vigente", fechaEval, fechaEstimada, fechaLimiteNormalizada: limite };
  }
  if (vig.tipo === "hasta_terminacion_contrato") {
    return { estado: "atado_a_contrato", fechaEval, fechaEstimada };
  }
  if (vig.tipo === "indefinida") {
    return { estado: "vigente", fechaEval, fechaEstimada };
  }
  return { estado: "desconocido", fechaEval, fechaEstimada };
}
