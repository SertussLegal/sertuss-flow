/**
 * Lightweight event bus for HTTP 402 (no credits) responses from edge functions.
 * Any caller that detects a credits-blocked situation should fire this event;
 * a single global listener (CreditsBlockedModal) translates it into a modal.
 */

export type CreditsBlockedSource =
  | "scan-document"
  | "process-expediente"
  | "generate-document"
  | "validar-con-claude"
  | "otro";

export interface CreditsBlockedDetail {
  source: CreditsBlockedSource | string;
  message?: string;
}

export const CREDITS_BLOCKED_EVENT = "credits:blocked";

export function emitCreditsBlocked(detail: CreditsBlockedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CREDITS_BLOCKED_EVENT, { detail }));
}

/**
 * Inspects an error/response payload and returns true if it indicates HTTP 402.
 * Supabase edge function errors expose `.context.status` or `.status`; the
 * helper aiGatewayErrorResponse from Phase 3 also serializes a body with
 * `error.code === "no_credits"`.
 */
export function isCreditsBlockedError(err: unknown, data?: unknown): boolean {
  // Direct status on error object
  const anyErr = err as any;
  if (anyErr) {
    if (anyErr.status === 402) return true;
    if (anyErr?.context?.status === 402) return true;
    const msg = String(anyErr?.message || "").toLowerCase();
    if (msg.includes("402") || msg.includes("payment required") || msg.includes("no credits")) {
      return true;
    }
  }
  // Body payload from edge function
  const body = data as any;
  if (body) {
    if (body?.error?.code === "no_credits") return true;
    if (body?.code === "no_credits") return true;
  }
  return false;
}
