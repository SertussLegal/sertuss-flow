/**
 * Centralized credit consumption wrapper.
 * Always calls consume_credit_v2 with full audit metadata (user_id, action, tipo_acto, tramite_id).
 * Atomicity is guaranteed inside the SQL function (FOR UPDATE + INSERT in same tx).
 */
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type CreditAction =
  | "VALIDACION_CLAUDE"
  | "OCR_DOCUMENTO"
  | "GENERACION_DOCX"
  | "APERTURA_EXPEDIENTE"
  | "OTRO";

export interface ConsumeCreditOpts {
  organizationId: string;
  userId: string;
  action: CreditAction | string;
  tramiteId?: string | null;
  tipoActo?: string | null;
  credits?: number;
  silent?: boolean;
}

export async function consumeCredit(opts: ConsumeCreditOpts): Promise<boolean> {
  const { data, error } = await supabase.rpc("consume_credit_v2", {
    p_org_id: opts.organizationId,
    p_user_id: opts.userId,
    p_action: opts.action,
    p_tramite_id: opts.tramiteId ?? undefined,
    p_tipo_acto: opts.tipoActo ?? undefined,
    p_credits: opts.credits ?? 1,
  });

  if (error) {
    if (!opts.silent) {
      toast({
        title: "Error al consumir crédito",
        description: error.message,
        variant: "destructive",
      });
    }
    return false;
  }

  if (!data) {
    if (!opts.silent) {
      toast({
        title: "Sin créditos disponibles",
        description: "Recarga créditos en /equipo para continuar.",
        variant: "destructive",
      });
    }
    return false;
  }
  return true;
}

/** Surface a friendly toast for HTTP 402/429 errors from edge functions. */
export function notifyHttpQuotaError(status: number, fallback?: string): boolean {
  if (status === 402) {
    toast({
      title: "Sin créditos disponibles",
      description: "Recarga créditos para continuar.",
      variant: "destructive",
    });
    return true;
  }
  if (status === 429) {
    toast({
      title: "Demasiadas solicitudes",
      description: "Espera unos segundos y vuelve a intentar.",
      variant: "destructive",
    });
    return true;
  }
  if (fallback) {
    toast({ title: fallback, variant: "destructive" });
  }
  return false;
}
