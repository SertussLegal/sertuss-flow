/**
 * @deprecated Fase 1 (2026-07): el auditor Claude en vivo fue retirado.
 *
 * Este archivo se conserva como stub porque `PersonaForm`, `InmuebleForm` y
 * `ActosForm` importan el tipo `Validacion` para su prop `inlineBadges`.
 * Ninguna función de red permanece. La lógica determinista vive en
 * `src/lib/computeTopIssues.ts`. Fase 2/3 decidirá si se reintroduce un
 * motor de badges o si el tipo se retira junto con los forms.
 */

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
  ui_target?: UiTarget;
  priority?: Priority;
}
