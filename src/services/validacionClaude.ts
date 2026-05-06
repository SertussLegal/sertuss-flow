import { supabase } from "@/integrations/supabase/client";
import { monitored } from "@/services/monitoredClient";

interface ValidacionParams {
  modo: "campos" | "documento";
  tramiteId: string;
  organizationId: string;
  tipoActo: string;
  tabOrigen?: string;
  datosExtraidos: Record<string, any>;
  correccionesGemini?: Array<{
    campo: string;
    original: string;
    corregido: string;
    razon: string;
  }>;
  validacionesApp?: string[];
  textoPreview?: string;
}

export type UiTarget = "modal_bloqueante" | "side_panel_audit" | "field_inline_badge";
export type Priority = "high" | "medium" | "low";

export interface Validacion {
  nivel: "error" | "advertencia" | "sugerencia";
  codigo_regla: string;
  campo: string;
  campos_relacionados?: string[];
  valor_actual?: string;
  valor_sugerido?: string;
  explicacion: string;
  auto_corregible: boolean;
  // Fase 3 — UI contract (opcionales para retrocompatibilidad)
  ui_target?: UiTarget;
  priority?: Priority;
}

export interface ValidacionResultado {
  estado: "aprobado" | "requiere_revision" | "errores_criticos" | "error_sistema";
  puntuacion?: number;
  validaciones: Validacion[];
  retroalimentacion_general: string;
}

/**
 * Llama al Edge Function validar-con-claude.
 * Si falla, devuelve un resultado de fallback — NUNCA bloquea el flujo.
 */
export async function validarConClaude(params: ValidacionParams): Promise<ValidacionResultado> {
  try {
    const { data, error } = await monitored.invoke("validar-con-claude", {
      modo: params.modo,
      tramite_id: params.tramiteId,
      organization_id: params.organizationId,
      tipo_acto: params.tipoActo,
      tab_origen: params.tabOrigen,
      datos_extraidos: params.datosExtraidos,
      correcciones_gemini: params.correccionesGemini || [],
      validaciones_app: params.validacionesApp || [],
      texto_preview: params.textoPreview,
    }, { tramiteId: params.tramiteId });

    if (error) throw error;
    return data as ValidacionResultado;
  } catch (error) {
    console.error("Error en validación Claude:", error);
    return {
      estado: "error_sistema",
      validaciones: [],
      retroalimentacion_general: "No se pudo completar la validación automática. El trámite puede continuar sin validación.",
    };
  }
}

/**
 * Obtiene las validaciones que aplican a un campo específico.
 * Útil para mostrar indicadores en campos individuales.
 */
export function obtenerValidacionesCampo(
  resultado: ValidacionResultado,
  campo: string
): Validacion[] {
  return resultado.validaciones.filter(
    (v) => v.campo === campo || v.campos_relacionados?.includes(campo)
  );
}

/**
 * Verifica si hay errores críticos en el resultado.
 * Útil para decidir si mostrar modal de confirmación antes del preview.
 */
export function tieneErroresCriticos(resultado: ValidacionResultado): boolean {
  return resultado.validaciones.some((v) => v.nivel === "error");
}

/**
 * Obtiene solo las validaciones auto-corregibles.
 * Útil para mostrar un botón "Aplicar correcciones automáticas".
 */
export function obtenerAutoCorregibles(resultado: ValidacionResultado): Validacion[] {
  return resultado.validaciones.filter((v) => v.auto_corregible && v.valor_sugerido);
}

/**
 * Cuenta validaciones por nivel.
 * Útil para mostrar un resumen tipo "2 errores, 3 advertencias, 1 sugerencia".
 */
export function contarPorNivel(resultado: ValidacionResultado): {
  errores: number;
  advertencias: number;
  sugerencias: number;
} {
  return {
    errores: resultado.validaciones.filter((v) => v.nivel === "error").length,
    advertencias: resultado.validaciones.filter((v) => v.nivel === "advertencia").length,
    sugerencias: resultado.validaciones.filter((v) => v.nivel === "sugerencia").length,
  };
}

// ============================================================
// Fase 3 — Selectores por destino UI
// ============================================================

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function priorityFromNivel(nivel: Validacion["nivel"]): Priority {
  if (nivel === "error") return "high";
  if (nivel === "advertencia") return "medium";
  return "low";
}

function getUiTarget(v: Validacion): UiTarget {
  return v.ui_target ?? "side_panel_audit";
}

function getPriority(v: Validacion): Priority {
  return v.priority ?? priorityFromNivel(v.nivel);
}

/** Validaciones críticas que deben mostrarse en un banner bloqueante (no inhabilita el botón). */
export function obtenerBloqueantes(validaciones: Validacion[]): Validacion[] {
  return validaciones.filter((v) => getUiTarget(v) === "modal_bloqueante");
}

/** Validaciones que deben mostrarse como dot inline junto al input afectado. */
export function obtenerInlineBadges(validaciones: Validacion[]): Validacion[] {
  return validaciones.filter((v) => getUiTarget(v) === "field_inline_badge");
}

/** Validaciones para el panel lateral, ordenadas por prioridad descendente. */
export function obtenerSidePanel(validaciones: Validacion[]): Validacion[] {
  return validaciones
    .filter((v) => getUiTarget(v) === "side_panel_audit")
    .slice()
    .sort((a, b) => PRIORITY_ORDER[getPriority(a)] - PRIORITY_ORDER[getPriority(b)]);
}
