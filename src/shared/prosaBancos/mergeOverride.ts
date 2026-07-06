// ============================================================================
// mergeOverride — Aplica el override editable del usuario sobre el ProsaContext
// base derivado de OCR/BD. Prioridad: Manual (override) > OCR > BD.
// ISOMÓRFICO (Deno + Vite). Sin efectos secundarios.
// ============================================================================

import type { ProsaApoderadoOverride, ProsaContext } from "./types.ts";

function nn(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function mergeOverride(
  base: ProsaContext,
  override: ProsaApoderadoOverride | null | undefined,
): ProsaContext {
  if (!override) return { ...base, notas_adicionales: base.notas_adicionales ?? null };

  const campos = override.campos_editados ?? {};
  const socOv = campos.sociedad_constitucion ?? {};

  const apo = { ...base.apoderado };
  if (nn(socOv.reforma_acta_numero) || nn(socOv.razon_social_anterior)) {
    apo.sociedad_constitucion = {
      ...(base.apoderado.sociedad_constitucion ?? {}),
      ...(nn(socOv.reforma_acta_numero) ? { reforma_acta_numero: socOv.reforma_acta_numero } : {}),
      ...(nn(socOv.razon_social_anterior) ? { razon_social_anterior: socOv.razon_social_anterior } : {}),
    };
  }

  const poderdante = { ...base.poderdante };
  if (nn(campos.representante_legal_cargo)) {
    poderdante.representante_legal_cargo = campos.representante_legal_cargo!;
  }
  if (nn(campos.representante_legal_cedula_expedida_en)) {
    poderdante.representante_legal_cedula_expedida_en = campos.representante_legal_cedula_expedida_en!;
  }

  return {
    ...base,
    apoderado: apo,
    poderdante,
    notas_adicionales: nn(override.notas_adicionales) ? override.notas_adicionales!.trim() : (base.notas_adicionales ?? null),
  };
}
