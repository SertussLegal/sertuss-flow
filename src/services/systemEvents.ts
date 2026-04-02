/**
 * Server-side (Edge Function) helper for logging to system_events.
 *
 * Usage inside an edge function:
 *   import { logServerEvent } from "./systemEvents.ts";
 *   await logServerEvent(supabase, { evento: "scan-document", ... });
 *
 * This file is meant to be copy-pasted or referenced by edge functions
 * that use service_role. It is NOT imported by the frontend.
 */

export interface ServerEvent {
  evento: string;
  resultado: "success" | "error" | "warning";
  categoria: string;
  detalle?: Record<string, unknown>;
  tiempo_ms?: number;
  organization_id?: string;
  tramite_id?: string;
  user_id?: string;
}

export async function logServerEvent(
  supabaseAdmin: any,
  event: ServerEvent,
): Promise<void> {
  try {
    await supabaseAdmin.from("system_events").insert({
      evento: event.evento,
      resultado: event.resultado,
      categoria: event.categoria,
      detalle: event.detalle ?? {},
      tiempo_ms: event.tiempo_ms ?? null,
      organization_id: event.organization_id ?? null,
      tramite_id: event.tramite_id ?? null,
      user_id: event.user_id ?? null,
    });
  } catch {
    // Never let logging break the main flow
  }
}
