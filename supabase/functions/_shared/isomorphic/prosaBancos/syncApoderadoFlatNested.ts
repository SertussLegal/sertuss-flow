// ============================================================================
// syncApoderadoFlatWithNested — Coherencia holística del apoderado.
//
// Problema que resuelve:
//   El OCR profundo v6 puebla dos vías paralelas para el mismo dato:
//     - Plano:   pb.apoderado_nombre, pb.apoderado_cedula  (lo que la UI edita)
//     - Anidado: pb.apoderado.nombre, pb.apoderado.cedula  (alimenta la prosa
//                de comparecencia/antefirma en la minuta v2)
//   El frontend SOLO edita el plano. Si el humano corrige "JUAN PEREZ" →
//   "JUAN PÉREZ RESTREPO" en el input, el anidado queda con el valor OCR
//   viejo y la prosa se imprime con el nombre incorrecto — mientras el tag
//   plano (que usa el certificado) queda con el nombre corregido. Resultado:
//   dos documentos generados en el mismo segundo con nombres distintos del
//   mismo apoderado.
//
// Solución:
//   Antes de renderizar los .docx, forzar plano → anidado (plano gana, en
//   línea con la política del proyecto: Manual > OCR > BD). Si hubo que
//   corregir, emitir un warning informativo en `_coherencia_warnings` +
//   `_coherencia_suspicious` para que la UI marque el campo en ámbar.
//
// Puro, isomórfico (Deno + Vite/Vitest), no lanza, idempotente.
// ============================================================================

export interface SyncApoderadoResult {
  /** Copia mutada de `pb` con .apoderado.nombre/cedula (y firmante si jurídica)
   *  alineados al plano. El objeto original no se muta. */
  synced: Record<string, unknown>;
  /** Códigos de warning generados. Subconjunto de:
   *   - "apoderado_nombre_divergencia_plano_anidado"
   *   - "apoderado_cedula_divergencia_plano_anidado"
   *   - "apoderado_multiple_firmantes_ambiguo"
   *  Ninguno tiene sufijo hard-block (no dispara "requiere revisión manual"). */
  warnings: string[];
  /** Paths de UI a marcar como sospechosos (mismos que ya cablea
   *  CancelacionValidar.tsx: "apoderado_nombre", "apoderado_cedula"). */
  suspicious: Set<string>;
}

/** Normalización para comparar plano vs anidado: uppercase + trim.
 *  Trata "null"/"undefined" literales como valores corruptos pero DISTINTOS
 *  de "" (absent) — así podemos diferenciar "anidado ausente → no tocar" de
 *  "anidado corrupto con null literal → sí sincronizar".
 *  El literal se colapsa a la cadena "\0NULLY\0" para forzar la desigualdad
 *  contra cualquier plano real. */
function normalize(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (s === "") return "";
  if (s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return "\0NULLY\0";
  return s.toUpperCase();
}

/** True si el valor está realmente poblado (no vacío, no null/undefined).
 *  Los literales tóxicos "null"/"undefined" cuentan como poblados-corruptos. */
function isPoblado(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim();
  return s !== "";
}

/** True si el campo anidado está SEMÁNTICAMENTE ausente (ni valor real ni
 *  literal tóxico). En ese caso no hay divergencia — no hay nada que
 *  sincronizar y no se emite warning. */
function isAnidadoAusente(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return s === "";
}

interface Firmante {
  nombre?: string | null;
  cedula?: string | null;
  cargo?: string | null;
  email?: string | null;
  es_firmante?: boolean;
}

/** Selecciona el firmante objetivo dentro de representantes[]. Misma heurística
 *  que `mergePoderBancoV6` (merge.ts:275-277): preferir `es_firmante=true` con
 *  nombre; fallback al primero con nombre; fallback al índice 0. */
function selectFirmante(
  reps: Firmante[],
): { idx: number; multipleFirmantes: boolean } | null {
  if (!Array.isArray(reps) || reps.length === 0) return null;
  const firmantesMarcados = reps
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r?.es_firmante === true && r?.nombre);
  if (firmantesMarcados.length > 0) {
    return { idx: firmantesMarcados[0].i, multipleFirmantes: firmantesMarcados.length > 1 };
  }
  const conNombre = reps.findIndex((r) => r?.nombre);
  if (conNombre >= 0) return { idx: conNombre, multipleFirmantes: false };
  return { idx: 0, multipleFirmantes: false };
}

export function syncApoderadoFlatWithNested(
  pb: Record<string, unknown> | null | undefined,
): SyncApoderadoResult {
  const warnings: string[] = [];
  const suspicious = new Set<string>();

  if (!pb || typeof pb !== "object") {
    return { synced: (pb ?? {}) as Record<string, unknown>, warnings, suspicious };
  }

  // Clone superficial + clones defensivos de los subárboles que podríamos tocar.
  const synced: Record<string, unknown> = { ...pb };
  const apoderadoIn = pb.apoderado as Record<string, unknown> | undefined | null;

  // Sin bloque anidado (V6 apagado / OCR sin apoderado) → nada que sincronizar.
  if (!apoderadoIn || typeof apoderadoIn !== "object") {
    return { synced, warnings, suspicious };
  }

  const planoNombre = pb.apoderado_nombre;
  const planoCedula = pb.apoderado_cedula;

  // Determinar tipo efectivo con override incluido (mismo criterio que
  // apoderadoClassifier: `tipo_override` gana sobre `tipo`).
  const tipoOverride = apoderadoIn.tipo_override as string | undefined | null;
  const tipoBase = apoderadoIn.tipo as string | undefined | null;
  const tipoEfectivo = (tipoOverride ?? tipoBase ?? null) as string | null;

  const apoderadoOut: Record<string, unknown> = { ...apoderadoIn };
  let apoderadoTouched = false;

  if (tipoEfectivo === "juridica") {
    // Persona jurídica: el plano representa al firmante persona natural que
    // actúa por la sociedad, NO la razón social. Sincronizar contra el
    // representante seleccionado + el snapshot desnormalizado
    // `apoderado.nombre`/`cedula` (que también alimenta la prosa antefirma).
    const repsIn = Array.isArray(apoderadoIn.representantes)
      ? (apoderadoIn.representantes as Firmante[])
      : [];
    const sel = selectFirmante(repsIn);
    if (sel) {
      if (sel.multipleFirmantes) {
        warnings.push("apoderado_multiple_firmantes_ambiguo");
        suspicious.add("apoderado_nombre");
      }
      const repIn = repsIn[sel.idx] || {};
      const repOut: Firmante = { ...repIn };
      let repTouched = false;

      // Nombre — solo sync si el anidado NO está semánticamente ausente
      // (evitamos "primer poblado" cuando el OCR simplemente no leyó ese campo).
      if (isPoblado(planoNombre) && !isAnidadoAusente(repIn.nombre)
        && normalize(planoNombre) !== normalize(repIn.nombre)) {
        repOut.nombre = String(planoNombre);
        repTouched = true;
        warnings.push("apoderado_nombre_divergencia_plano_anidado");
        suspicious.add("apoderado_nombre");
      }
      // Cédula
      if (isPoblado(planoCedula) && !isAnidadoAusente(repIn.cedula)
        && normalize(planoCedula) !== normalize(repIn.cedula)) {
        repOut.cedula = String(planoCedula);
        repTouched = true;
        warnings.push("apoderado_cedula_divergencia_plano_anidado");
        suspicious.add("apoderado_cedula");
      }

      if (repTouched) {
        const repsOut = [...repsIn];
        repsOut[sel.idx] = repOut;
        apoderadoOut.representantes = repsOut;
        apoderadoTouched = true;
      }

      // Mantener el invariante que ya cumple mergePoderBancoV6: el snapshot
      // desnormalizado `apoderado.nombre`/`cedula` refleja al firmante. Solo
      // se sobrescribe si el snapshot no está ausente Y difiere.
      if (isPoblado(planoNombre) && !isAnidadoAusente(apoderadoIn.nombre)
        && normalize(planoNombre) !== normalize(apoderadoIn.nombre)) {
        apoderadoOut.nombre = String(planoNombre);
        apoderadoTouched = true;
      }
      if (isPoblado(planoCedula) && !isAnidadoAusente(apoderadoIn.cedula)
        && normalize(planoCedula) !== normalize(apoderadoIn.cedula)) {
        apoderadoOut.cedula = String(planoCedula);
        apoderadoTouched = true;
      }
    }
  } else {
    // Persona natural o tipo desconocido (V6 apagado pero anidado poblado):
    // sincronizar directamente contra `apoderado.nombre`/`cedula`. Si el
    // anidado está ausente (V6 off puro), no hay divergencia real.
    if (isPoblado(planoNombre) && !isAnidadoAusente(apoderadoIn.nombre)
      && normalize(planoNombre) !== normalize(apoderadoIn.nombre)) {
      apoderadoOut.nombre = String(planoNombre);
      apoderadoTouched = true;
      warnings.push("apoderado_nombre_divergencia_plano_anidado");
      suspicious.add("apoderado_nombre");
    }
    if (isPoblado(planoCedula) && !isAnidadoAusente(apoderadoIn.cedula)
      && normalize(planoCedula) !== normalize(apoderadoIn.cedula)) {
      apoderadoOut.cedula = String(planoCedula);
      apoderadoTouched = true;
      warnings.push("apoderado_cedula_divergencia_plano_anidado");
      suspicious.add("apoderado_cedula");
    }
  }

  if (apoderadoTouched) {
    synced.apoderado = apoderadoOut;
  }

  return { synced, warnings, suspicious };
}
