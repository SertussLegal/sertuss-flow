// ============================================================================
// mergeRegenPayload — helper puro para el modo `regen` de procesar-cancelacion.
//
// Combina `data_ia` (extracción original de la IA), `data_final` (edición
// previa del usuario) y `overrides` (payload del frontend) preservando el
// bloque profundo v6 de `poder_banco` (apoderado.sociedad_*, representantes,
// poderdante, instrumento_poder, facultades, motivos_incompletitud, ...) que
// el frontend NO edita y que un `data_final` histórico puede haber perdido.
//
// Reglas:
//   1. `overrides` gana en campos que envía explícitamente (frontend SSOT).
//   2. Campos no enviados por `overrides` NUNCA se borran — se toman de
//      `data_final` o, en su defecto, de `data_ia`.
//   3. `poder_banco` se fusiona por-clave: iaPB → basePB → ovPB (último gana).
//      Esto rescata el bloque profundo aunque `data_final` histórico lo haya
//      perdido, sin bloquear las ediciones planas del frontend.
// ============================================================================

export function mergeRegenPayload<T extends Record<string, unknown>>(args: {
  dataIa: T | null | undefined;
  dataFinal: T | null | undefined;
  overrides: Partial<T> | null | undefined;
}): T {
  const dataIa = (args.dataIa ?? {}) as Record<string, unknown>;
  const base = (args.dataFinal ?? args.dataIa ?? {}) as Record<string, unknown>;
  const overrides = (args.overrides ?? {}) as Record<string, unknown>;

  const iaPB = (dataIa.poder_banco ?? {}) as Record<string, unknown>;
  const basePB = (base.poder_banco ?? {}) as Record<string, unknown>;
  const ovPB = (overrides.poder_banco ?? {}) as Record<string, unknown>;

  // Merge por-clave DENTRO de `poderdante` — un override parcial del frontend
  // (ej. solo `representante_legal_cedula`) NUNCA debe borrar `menciones_rl`
  // ni el resto de escalares heredados de data_ia/data_final. Aplica la misma
  // filosofía que ya rige a nivel de `poder_banco`.
  const iaPD = (iaPB.poderdante ?? {}) as Record<string, unknown>;
  const basePD = (basePB.poderdante ?? {}) as Record<string, unknown>;
  const ovPD = (ovPB.poderdante ?? {}) as Record<string, unknown>;
  const hasPD =
    (iaPB && "poderdante" in iaPB) ||
    (basePB && "poderdante" in basePB) ||
    (ovPB && "poderdante" in ovPB);
  const mergedPD = hasPD ? { ...iaPD, ...basePD, ...ovPD } : undefined;

  // Merge por-clave DENTRO de `apoderado` — un override parcial del frontend
  // (ej. solo `cedula`) NUNCA debe borrar `menciones_cedula` ni el resto de
  // escalares/subobjetos heredados. Mismo criterio que `poderdante`.
  const iaAp = (iaPB.apoderado ?? {}) as Record<string, unknown>;
  const baseAp = (basePB.apoderado ?? {}) as Record<string, unknown>;
  const ovAp = (ovPB.apoderado ?? {}) as Record<string, unknown>;
  const hasAp =
    (iaPB && "apoderado" in iaPB) ||
    (basePB && "apoderado" in basePB) ||
    (ovPB && "apoderado" in ovPB);
  const mergedAp = hasAp ? { ...iaAp, ...baseAp, ...ovAp } : undefined;

  const mergedPB: Record<string, unknown> = { ...iaPB, ...basePB, ...ovPB };
  if (mergedPD !== undefined) mergedPB.poderdante = mergedPD;
  if (mergedAp !== undefined) mergedPB.apoderado = mergedAp;

  return { ...base, ...overrides, poder_banco: mergedPB } as unknown as T;
}
