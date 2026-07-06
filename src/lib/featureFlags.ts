// Feature flags del cliente (Vite). Mantener paralelo al flag de la edge
// `supabase/functions/_shared/poderBancoSchemaVersion.ts`.
//
// Rollout: por defecto ENCENDIDO en preview/prod, apagable vía VITE_POWER_V5_ENABLED=false.
const raw = (import.meta.env.VITE_POWER_V5_ENABLED ?? "true") as string;
export const POWER_V5_ENABLED = raw !== "false";
