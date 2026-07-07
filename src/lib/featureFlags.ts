// ============================================================================
// Feature flags del cliente (Vite). Mantener en sincronía con la matriz de
// flags de la edge — ver `supabase/functions/_shared/poderBancoSchemaVersion.ts`.
//
// P5 (higiene de nombres): la flag pasó a llamarse VITE_POWER_DEEP_UI_ENABLED.
// Se mantiene lectura dual con el alias legacy VITE_POWER_V5_ENABLED durante
// 30 días para no romper deployments con secrets viejos.
//
// Rollout: por defecto ENCENDIDO en preview/prod; apagable con `"false"`.
// ============================================================================

const rawNew = import.meta.env.VITE_POWER_DEEP_UI_ENABLED as string | undefined;
const rawLegacy = import.meta.env.VITE_POWER_V5_ENABLED as string | undefined;
const raw = (rawNew ?? rawLegacy ?? "true") as string;

/** Muestra la UI profunda del Poder en Cancelaciones. */
export const POWER_DEEP_UI_ENABLED = raw !== "false";

/** Alias legacy — mantener 30 días. */
export const POWER_V5_ENABLED = POWER_DEEP_UI_ENABLED;
