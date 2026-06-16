/**
 * Centralized Supabase wrapper for edge function invocations.
 *
 * IMPORTANTE (seguridad): el cliente NO escribe directamente en `system_events`.
 * La política RLS de INSERT para usuarios autenticados fue revocada para evitar
 * polución del audit trail. Toda persistencia de eventos del sistema ocurre
 * server-side (edge functions con service_role o RPC SECURITY DEFINER).
 *
 * Este wrapper mide latencia y emite logs locales (console) en errores,
 * pero NO inserta filas. Las edge functions ya registran sus propios eventos.
 */

import { supabase } from "@/integrations/supabase/client";

// ── public API ───────────────────────────────────────────────────────────

export const monitored = {
  /**
   * Wrapper around supabase.functions.invoke que mide latencia y emite
   * logs locales en consola. NO persiste en system_events (server-side only).
   */
  async invoke<T = any>(
    functionName: string,
    body: Record<string, unknown>,
    _options?: { tramiteId?: string },
  ): Promise<{ data: T | null; error: Error | null }> {
    const start = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke(functionName, { body });
      const elapsed = Math.round(performance.now() - start);
      if (error) {
        // Log local — no PII, solo metadata operativa.
        console.warn(`[monitored] ${functionName} failed in ${elapsed}ms:`, error.message);
        return { data: null, error };
      }
      return { data: data as T, error: null };
    } catch (err: any) {
      const elapsed = Math.round(performance.now() - start);
      console.warn(`[monitored] ${functionName} threw in ${elapsed}ms:`, err?.message ?? String(err));
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  },

  /**
   * Log no-op para compatibilidad con call-sites legacy.
   * Los eventos persistentes deben emitirse desde el servidor.
   */
  log(
    evento: string,
    resultado: "success" | "error" | "warning",
    categoria: string,
    detalle: Record<string, unknown> = {},
  ) {
    if (resultado === "error") {
      console.warn(`[monitored:${categoria}] ${evento}`, detalle);
    }
  },
};

