/**
 * Centralized Supabase wrapper that automatically logs all edge function
 * invocations and database errors to the `system_events` table.
 *
 * Usage:
 *   import { monitored } from "@/services/monitoredClient";
 *   const { data, error } = await monitored.invoke("scan-document", body);
 *
 * Every call is measured (ms) and the result is persisted fire-and-forget,
 * so instrumentation never blocks or breaks the UI.
 */

import { supabase } from "@/integrations/supabase/client";

// ── helpers ──────────────────────────────────────────────────────────────

async function getContext() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return { user_id: null, organization_id: null };

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", session.user.id)
      .maybeSingle();

    return {
      user_id: session.user.id,
      organization_id: profile?.organization_id ?? null,
    };
  } catch {
    return { user_id: null, organization_id: null };
  }
}

/** Fire-and-forget insert into system_events — never throws */
function logEvent(
  evento: string,
  resultado: "success" | "error" | "warning",
  categoria: string,
  detalle: Record<string, unknown> = {},
  tiempo_ms?: number,
  ctx?: { user_id: string | null; organization_id: string | null },
  tramite_id?: string,
) {
  const doLog = async () => {
    const context = ctx ?? await getContext();
    await supabase.from("system_events" as any).insert({
      evento,
      resultado,
      categoria,
      detalle,
      tiempo_ms: tiempo_ms ?? null,
      user_id: context.user_id,
      organization_id: context.organization_id,
      tramite_id: tramite_id ?? null,
    } as any);
  };
  doLog().catch(() => {});
}

// ── public API ───────────────────────────────────────────────────────────

export const monitored = {
  /**
   * Wrapper around supabase.functions.invoke that automatically logs
   * timing, success and error to system_events.
   */
  async invoke<T = any>(
    functionName: string,
    body: Record<string, unknown>,
    options?: { tramiteId?: string },
  ): Promise<{ data: T | null; error: Error | null }> {
    const ctx = await getContext();
    const start = performance.now();

    try {
      const { data, error } = await supabase.functions.invoke(functionName, { body });
      const elapsed = Math.round(performance.now() - start);

      if (error) {
        logEvent(
          functionName,
          "error",
          "edge_function",
          { message: error.message, body_keys: Object.keys(body) },
          elapsed,
          ctx,
          options?.tramiteId,
        );
        return { data: null, error };
      }

      logEvent(
        functionName,
        "success",
        "edge_function",
        { body_keys: Object.keys(body) },
        elapsed,
        ctx,
        options?.tramiteId,
      );
      return { data: data as T, error: null };
    } catch (err: any) {
      const elapsed = Math.round(performance.now() - start);
      logEvent(
        functionName,
        "error",
        "edge_function",
        { message: err?.message ?? "Unknown", body_keys: Object.keys(body) },
        elapsed,
        ctx,
        options?.tramiteId,
      );
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  },

  /** Log a custom business event (manual, for specific cases) */
  log: logEvent,
};
