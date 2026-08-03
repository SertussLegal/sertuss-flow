// ============================================================================
// alertasCancelacion — fuente única de verdad del modelo de ALERTAS que
// reemplaza a la compuerta de generación ("manual review required").
//
// Rediseño 2026-08-03: el documento SIEMPRE se genera y se previsualiza. Las
// alertas informan. Solo las decisiones pendientes ("prioritarias") detienen
// la DESCARGA, nunca la vista ni la generación.
//
// Dos responsabilidades:
//   1. `computeAlertas(dataFinal)` — lee warnings crudos ya emitidos por la
//      validación (NO los recalcula: `validate.ts` es intocable) y los
//      clasifica en prioritaria / importante / informativa.
//   2. `applyPendingDecisionBlanks(data)` — blanquea en una COPIA de render
//      todo dato que sea una decisión pendiente, para que el .docx salga con
//      blancos honestos (`___________`) en vez de una elección silenciosa del
//      modelo. NUNCA muta la entrada, NUNCA se persiste.
//
// 🛡️ PUREZA: solo TS, isomórfico (edge + client). Sin fetch, sin Deno, sin BD.
// ============================================================================

import {
  WARNING_LABELS,
  normalizeCedula,
} from "./poderBancoExtractor/validate.ts";
import { filterMotivosByScalarRecompute } from "./scalarGatingRecompute.ts";
import { CUANTIA_CONFLICTO_ORIGEN, CUANTIA_CONFLICTO_WARNING } from "./cuantiaConflicto.ts";

export type CategoriaAlerta = "prioritaria" | "importante" | "informativa";
export type SeccionAlerta = "poder" | "inmueble" | "hipoteca" | "partes" | "documento";

export interface Alerta {
  codigo: string;
  categoria: CategoriaAlerta;
  seccion: SeccionAlerta;
  /** Siempre === (categoria === "prioritaria"). Explícito para la UI. */
  bloqueaDescarga: boolean;
  /** Label corto para el encabezado de la tarjeta de alerta. */
  label: string;
  /** Descripción larga (la del catálogo `WARNING_LABELS` cuando existe). */
  descripcion: string;
  detalle?: Record<string, unknown>;
}

// ── Centinela NO_LEGIBLE ────────────────────────────────────────────────
// Los 6 paths del prompt v7 donde el modelo puede emitir el centinela.
// Movido desde `procesar-cancelacion/index.ts::detectRequiereRevisionManual`
// sin cambios: misma lista, mismo orden.
export const NO_LEGIBLE_PODER_PATHS = [
  "poder_banco.apoderado_cedula",
  "poder_banco.apoderado_escritura",
  "poder_banco.apoderado_fecha",
  "poder_banco.apoderado.cedula",
  "poder_banco.instrumento_poder.escritura_num",
  "poder_banco.instrumento_poder.fecha",
] as const;

export const NO_LEGIBLE_SENTINEL = "NO_LEGIBLE";

/** Path del centinela → código canónico de warning equivalente. Permite
 *  deduplicar la alerta que llega por `_coherencia_warnings` con la que
 *  detectamos leyendo el dato crudo: son el mismo hecho. */
const PATH_TO_NO_LEGIBLE_CODE: Record<string, string> = {
  "poder_banco.apoderado_cedula": "apoderado_cedula_no_legible",
  "poder_banco.apoderado.cedula": "apoderado_cedula_no_legible",
  "poder_banco.apoderado_escritura": "escritura_poder_no_legible",
  "poder_banco.instrumento_poder.escritura_num": "escritura_poder_no_legible",
  "poder_banco.apoderado_fecha": "fecha_poder_no_legible",
  "poder_banco.instrumento_poder.fecha": "fecha_poder_no_legible",
};

/** Código genérico para un centinela NO_LEGIBLE en un path no catalogado
 *  (ej. `menciones_direccion[].valor`). Nunca silencioso. */
export const CODIGO_CAMPO_NO_LEGIBLE = "campo_no_legible";

// ── Catálogo de clasificación ───────────────────────────────────────────

interface ClasificacionAlerta {
  categoria: CategoriaAlerta;
  seccion: SeccionAlerta;
}

/**
 * Tabla de clasificación aprobada por producto (plan, sección 1.1).
 * Regla de default para códigos futuros no catalogados: `importante` /
 * `documento`. Nunca `prioritaria` por defecto (bloquear por accidente es
 * peor que avisar), nunca silencioso.
 */
export const CLASIFICACION_ALERTAS: Record<string, ClasificacionAlerta> = {
  // ── Prioritarias: decisiones pendientes del humano ──
  apoderado_natural_candidatos_requiere_confirmacion: { categoria: "prioritaria", seccion: "poder" },
  [CUANTIA_CONFLICTO_WARNING]: { categoria: "prioritaria", seccion: "hipoteca" },
  apoderado_cedula_no_legible: { categoria: "prioritaria", seccion: "poder" },
  escritura_poder_no_legible: { categoria: "prioritaria", seccion: "poder" },
  fecha_poder_no_legible: { categoria: "prioritaria", seccion: "poder" },
  [CODIGO_CAMPO_NO_LEGIBLE]: { categoria: "prioritaria", seccion: "poder" },

  // ── Importantes: verificar contra el PDF, no bloquean ──
  apoderado_cedula_menciones_incoherentes: { categoria: "importante", seccion: "poder" },
  rl_banco_menciones_incoherentes: { categoria: "importante", seccion: "poder" },
  inmueble_matricula_menciones_incoherentes: { categoria: "importante", seccion: "inmueble" },
  inmueble_direccion_menciones_incoherentes: { categoria: "importante", seccion: "inmueble" },
  apoderado_cedula_divergencia_lecturas: { categoria: "importante", seccion: "poder" },
  escritura_poder_divergencia_lecturas: { categoria: "importante", seccion: "poder" },
  fecha_poder_divergencia_lecturas: { categoria: "importante", seccion: "poder" },
  apoderado_cedula_placeholder: { categoria: "importante", seccion: "poder" },
  apoderado_nombre_duplicidad_cruzada: { categoria: "importante", seccion: "poder" },
  apoderado_cedula_duplicidad_cruzada: { categoria: "importante", seccion: "poder" },
  poder_entidad_nit_incoherente: { categoria: "importante", seccion: "poder" },
  poder_entidad_nombre_incoherente: { categoria: "importante", seccion: "poder" },
  escritura_num_incoherente: { categoria: "importante", seccion: "poder" },
  fecha_incoherente: { categoria: "importante", seccion: "poder" },
  apoderado_coincide_con_rl_banco: { categoria: "importante", seccion: "poder" },
  apoderado_multiple_firmantes_ambiguo: { categoria: "importante", seccion: "poder" },
  cedula_formato_invalido: { categoria: "importante", seccion: "partes" },
  direccion_catastral_ocr: { categoria: "importante", seccion: "inmueble" },
  escritura_truncada: { categoria: "importante", seccion: "documento" },

  // ── Informativas: contexto, el sistema ya decidió ──
  apoderado_cedula_confianza_baja: { categoria: "informativa", seccion: "poder" },
  poderdante_rl_cedula_confianza_baja: { categoria: "informativa", seccion: "poder" },
  escritura_poder_confianza_baja: { categoria: "informativa", seccion: "poder" },
  fecha_poder_confianza_baja: { categoria: "informativa", seccion: "poder" },
  direccion_indice_corregido_por_codigo: { categoria: "informativa", seccion: "inmueble" },
  apoderado_nombre_divergencia_plano_anidado: { categoria: "informativa", seccion: "poder" },
  apoderado_cedula_divergencia_plano_anidado: { categoria: "informativa", seccion: "poder" },
  aplica_ley_546: { categoria: "informativa", seccion: "hipoteca" },
};

export const CLASIFICACION_DEFAULT: ClasificacionAlerta = {
  categoria: "importante",
  seccion: "documento",
};

/** Labels de los códigos que NO son warnings de validación (avisos de
 *  procesamiento y contexto legal). No se contamina `WARNING_LABELS`. */
export const AVISO_LABELS: Record<string, string> = {
  direccion_catastral_ocr:
    "La dirección catastral proviene de una lectura automática que no se pudo verificar contra otra fuente — revisa los dígitos contra el PDF del certificado.",
  escritura_truncada:
    "La escritura era demasiado extensa y se analizó solo parcialmente — verifica que los datos extraídos correspondan al acto correcto.",
  aplica_ley_546:
    "El crédito está sujeto a la Ley 546 de 1999 (vivienda) — verifica el tratamiento aplicable.",
  [CODIGO_CAMPO_NO_LEGIBLE]:
    "Uno o más campos quedaron marcados como no legibles por el OCR — salen en blanco en el documento; complétalos manualmente.",
};

/** Label corto para el encabezado de la tarjeta (Fase 2: panel lateral). */
export const LABELS_CORTOS: Record<string, string> = {
  apoderado_natural_candidatos_requiere_confirmacion: "Elige el apoderado",
  [CUANTIA_CONFLICTO_WARNING]: "Define el valor del crédito",
  apoderado_cedula_no_legible: "Cédula del apoderado ilegible",
  escritura_poder_no_legible: "Escritura del poder ilegible",
  fecha_poder_no_legible: "Fecha del poder ilegible",
  [CODIGO_CAMPO_NO_LEGIBLE]: "Campos ilegibles",
  apoderado_cedula_menciones_incoherentes: "Cédula del apoderado inconsistente",
  rl_banco_menciones_incoherentes: "Cédula del representante legal inconsistente",
  inmueble_matricula_menciones_incoherentes: "Matrícula inconsistente",
  inmueble_direccion_menciones_incoherentes: "Dirección inconsistente",
  apoderado_cedula_divergencia_lecturas: "Doble lectura discrepa (cédula)",
  escritura_poder_divergencia_lecturas: "Doble lectura discrepa (escritura)",
  fecha_poder_divergencia_lecturas: "Doble lectura discrepa (fecha)",
  apoderado_cedula_placeholder: "Cédula con patrón placeholder",
  apoderado_nombre_duplicidad_cruzada: "Nombre repetido en otro trámite",
  apoderado_cedula_duplicidad_cruzada: "Cédula repetida en otro trámite",
  poder_entidad_nit_incoherente: "NIT del poder no coincide",
  poder_entidad_nombre_incoherente: "Banco del poder no coincide",
  escritura_num_incoherente: "Número de escritura inconsistente",
  fecha_incoherente: "Fecha del poder inconsistente",
  apoderado_coincide_con_rl_banco: "Apoderado igual al representante legal",
  apoderado_multiple_firmantes_ambiguo: "Varios firmantes en el poder",
  cedula_formato_invalido: "Cédula con formato inválido",
  direccion_catastral_ocr: "Verifica la dirección catastral",
  escritura_truncada: "Escritura analizada parcialmente",
  apoderado_cedula_confianza_baja: "Confianza baja (cédula del apoderado)",
  poderdante_rl_cedula_confianza_baja: "Confianza baja (cédula del RL)",
  escritura_poder_confianza_baja: "Confianza baja (escritura)",
  fecha_poder_confianza_baja: "Confianza baja (fecha)",
  direccion_indice_corregido_por_codigo: "Dirección elegida automáticamente",
  apoderado_nombre_divergencia_plano_anidado: "Se usó tu corrección (nombre)",
  apoderado_cedula_divergencia_plano_anidado: "Se usó tu corrección (cédula)",
  aplica_ley_546: "Aplica Ley 546 de 1999",
};

/** Instrucción concreta para las prioritarias (listado de acciones). */
export const INSTRUCCIONES_PRIORITARIAS: Record<string, string> = {
  apoderado_natural_candidatos_requiere_confirmacion:
    "El poder nombra a varias personas. Selecciona en la sección Poder cuál actuó en este trámite.",
  [CUANTIA_CONFLICTO_WARNING]:
    "La escritura contiene varias cifras distintas como valor del crédito. Elige el monto correcto o confirma que la cuantía es indeterminada.",
  apoderado_cedula_no_legible:
    "El OCR no pudo leer la cédula del apoderado. Escríbela manualmente en la sección Poder.",
  escritura_poder_no_legible:
    "El OCR no pudo leer el número de escritura del poder. Escríbelo manualmente en la sección Poder.",
  fecha_poder_no_legible:
    "El OCR no pudo leer la fecha del poder. Escríbela manualmente en la sección Poder.",
  [CODIGO_CAMPO_NO_LEGIBLE]:
    "Hay campos que el OCR no pudo leer. Complétalos manualmente antes de descargar.",
};

// ── Helpers de lectura ──────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function warningsDe(rama: unknown): string[] {
  const r = asRecord(rama);
  const w = r._coherencia_warnings;
  return Array.isArray(w) ? w.filter((x): x is string => typeof x === "string") : [];
}

function getPath(root: Record<string, unknown>, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Recorre recursivamente buscando el centinela textual. Devuelve los paths
 *  con notación de punto/índice. Se detiene a profundidad razonable. */
function buscarCentinelas(value: unknown, prefix: string, out: string[], depth = 0): void {
  if (depth > 8) return;
  if (typeof value === "string") {
    if (value === NO_LEGIBLE_SENTINEL) out.push(prefix);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => buscarCentinelas(v, `${prefix}[${i}]`, out, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      buscarCentinelas(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
  }
}

// ── Condiciones de resolución de las prioritarias ───────────────────────

/** `true` cuando el humano ya eligió un candidato que sigue vigente en la
 *  lista actual. Mismo criterio que la Regla 8 de `validate.ts`: si la lista
 *  cambió tras un reproceso, una confirmación vieja NO resuelve nada. */
export function candidatoApoderadoConfirmado(dataFinal: unknown): boolean {
  const pb = asRecord(asRecord(dataFinal).poder_banco);
  const apo = asRecord(pb.apoderado);
  const cands = Array.isArray(apo.candidatos_natural)
    ? (apo.candidatos_natural as Array<Record<string, unknown>>)
    : [];
  const conf = normalizeCedula(apo.candidato_confirmado_cedula as string | undefined);
  if (!conf) return false;
  return cands.some((c) => normalizeCedula(c?.cedula as string | undefined) === conf);
}

/** `true` cuando el humano resolvió el conflicto de cuantía: eligió un monto
 *  o confirmó "indeterminada". Ambas vías estampan `cuantia_origen="manual"`. */
export function cuantiaConflictoResuelto(dataFinal: unknown): boolean {
  const ha = asRecord(asRecord(dataFinal).hipoteca_anterior);
  return ha.cuantia_origen === "manual";
}

// ── computeAlertas ──────────────────────────────────────────────────────

/**
 * Lee los warnings ya emitidos por la validación y los clasifica. NO
 * recalcula reglas de negocio (`validate.ts` es intocable), salvo el
 * recálculo escalar determinista de `filterMotivosByScalarRecompute`, que
 * solo APAGA códigos gating cuyo dato ya fue corregido a mano.
 *
 * NO usa `applyManualOverrideExceptions`: sus predicados apagan el warning
 * en cuanto el escalar tiene FORMATO válido, y un dato equivocado del OCR
 * casi siempre tiene formato válido — las alertas `*_menciones_incoherentes`
 * se auto-apagarían al instante y nunca serían visibles.
 */
export function computeAlertas(
  dataFinal: Record<string, unknown> | null | undefined,
): Alerta[] {
  const data = asRecord(dataFinal);
  const pb = asRecord(data.poder_banco);

  // 1. Warnings crudos de las tres ramas que los persisten.
  const crudos = [
    ...warningsDe(data.poder_banco),
    ...warningsDe(data.inmueble),
    ...warningsDe(data.hipoteca_anterior),
  ];

  // 2. Recálculo escalar determinista (apaga códigos gating ya corregidos).
  let codigos = filterMotivosByScalarRecompute(crudos, {
    poder_banco: data.poder_banco,
    partes: data.partes
      ? {
          banco_nit: (asRecord(data.partes).banco_nit as string | null) ?? null,
          banco_acreedor: (asRecord(data.partes).banco_acreedor as string | null) ?? null,
        }
      : null,
  });

  // 3. Centinelas NO_LEGIBLE leídos del dato vigente (no del snapshot).
  const pathsNoLegibles: string[] = [];
  for (const p of NO_LEGIBLE_PODER_PATHS) {
    if (getPath(data, p) === NO_LEGIBLE_SENTINEL) pathsNoLegibles.push(p);
  }
  const otrosCentinelas: string[] = [];
  buscarCentinelas(data, "", otrosCentinelas);
  const extraPaths = otrosCentinelas.filter(
    (p) => !(NO_LEGIBLE_PODER_PATHS as readonly string[]).includes(p),
  );

  const detallePorCodigo: Record<string, Record<string, unknown>> = {};
  for (const p of pathsNoLegibles) {
    const cod = PATH_TO_NO_LEGIBLE_CODE[p];
    if (!cod) continue;
    codigos.push(cod);
    const prev = (detallePorCodigo[cod]?.paths as string[] | undefined) ?? [];
    detallePorCodigo[cod] = { paths: [...prev, p] };
  }
  if (extraPaths.length > 0) {
    codigos.push(CODIGO_CAMPO_NO_LEGIBLE);
    detallePorCodigo[CODIGO_CAMPO_NO_LEGIBLE] = { paths: extraPaths };
  }

  // 4. Avisos de procesamiento.
  const avisos = asRecord(data._avisos_procesamiento);
  for (const clave of Object.keys(avisos)) {
    codigos.push(clave);
    detallePorCodigo[clave] = asRecord(avisos[clave]);
  }

  // 5. Contexto legal.
  const analisis = asRecord(data.analisis_legal);
  if (analisis.aplica_ley_546 === true) codigos.push("aplica_ley_546");

  // 6. Resolución explícita de las prioritarias.
  if (candidatoApoderadoConfirmado(data)) {
    codigos = codigos.filter((c) => c !== "apoderado_natural_candidatos_requiere_confirmacion");
  }
  if (cuantiaConflictoResuelto(data)) {
    codigos = codigos.filter((c) => c !== CUANTIA_CONFLICTO_WARNING);
  }

  // 7. Dedupe por código, preservando orden de aparición.
  const vistos = new Set<string>();
  const alertas: Alerta[] = [];
  for (const codigo of codigos) {
    if (vistos.has(codigo)) continue;
    vistos.add(codigo);
    const cls = CLASIFICACION_ALERTAS[codigo] ?? CLASIFICACION_DEFAULT;
    const descripcion =
      WARNING_LABELS[codigo] ?? AVISO_LABELS[codigo] ?? `Alerta sin catalogar: ${codigo}`;
    alertas.push({
      codigo,
      categoria: cls.categoria,
      seccion: cls.seccion,
      bloqueaDescarga: cls.categoria === "prioritaria",
      label: LABELS_CORTOS[codigo] ?? codigo,
      descripcion,
      detalle: detallePorCodigo[codigo],
    });
  }

  // Orden estable: prioritarias → importantes → informativas.
  const peso: Record<CategoriaAlerta, number> = {
    prioritaria: 0,
    importante: 1,
    informativa: 2,
  };
  return alertas.sort((a, b) => peso[a.categoria] - peso[b.categoria]);
}

/** Atajo: número de alertas que bloquean la descarga. */
export function contarPrioritarias(alertas: Alerta[]): number {
  return alertas.filter((a) => a.bloqueaDescarga).length;
}

// ── applyPendingDecisionBlanks ──────────────────────────────────────────

/** Elimina recursivamente los centinelas NO_LEGIBLE (→ `undefined`), sin
 *  mutar la entrada. `nullGetter` de Docxtemplater los pinta `___________`. */
function stripNoLegible(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === "string") return value === NO_LEGIBLE_SENTINEL ? undefined : value;
  if (Array.isArray(value)) return value.map((v) => stripNoLegible(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripNoLegible(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Devuelve una COPIA de `data` lista para render, con las decisiones
 * pendientes en blanco. NUNCA muta la entrada, NUNCA se persiste: se llama
 * únicamente dentro de `generateAndUploadCancelacionDocs`, sobre la copia
 * que alimenta `buildDocxVars`.
 *
 * Reglas:
 *  1. Centinela `NO_LEGIBLE` en cualquier profundidad → `undefined`.
 *  2. Apoderado multi-candidato sin confirmar → nombre y cédula en blanco
 *     (plano y anidado). Nunca la elección silenciosa del modelo.
 *  3. Conflicto de cuantía sin resolver → valor vacío y
 *     `valor_hipoteca_es_indeterminada=false` ⇒ cláusula de pago NEUTRAL.
 *     `hipoteca_garantia_abierta` NO se toca (es un hecho textual leído de
 *     la escritura, no una inferencia).
 */
export function applyPendingDecisionBlanks<T extends Record<string, unknown>>(
  data: T,
): { data: T; aplicados: string[] } {
  const aplicados: string[] = [];

  // Regla 1 — NO_LEGIBLE global (ya produce una copia profunda del árbol).
  const centinelas: string[] = [];
  buscarCentinelas(data, "", centinelas);
  let out = (centinelas.length > 0 ? stripNoLegible(data) : { ...data }) as T;
  if (centinelas.length > 0) aplicados.push("no_legible_blanqueado");

  // Regla 2 — Apoderado sin confirmar.
  const pb = asRecord(out.poder_banco);
  const apo = asRecord(pb.apoderado);
  const cands = Array.isArray(apo.candidatos_natural)
    ? (apo.candidatos_natural as Array<Record<string, unknown>>)
    : [];
  if (cands.length >= 2 && !candidatoApoderadoConfirmado(out)) {
    const apoBlank: Record<string, unknown> = { ...apo, nombre: undefined, cedula: undefined };
    const pbBlank: Record<string, unknown> = {
      ...pb,
      apoderado_nombre: undefined,
      apoderado_cedula: undefined,
      apoderado: apoBlank,
    };
    out = { ...out, poder_banco: pbBlank } as T;
    aplicados.push("apoderado_candidato_sin_confirmar");
  }

  // Regla 3 — Conflicto de cuantía sin resolver.
  const ha = asRecord(out.hipoteca_anterior);
  if (ha.cuantia_origen === CUANTIA_CONFLICTO_ORIGEN) {
    const haBlank: Record<string, unknown> = {
      ...ha,
      valor_hipoteca_original: "",
      valor_hipoteca_es_indeterminada: false,
    };
    out = { ...out, hipoteca_anterior: haBlank } as T;
    aplicados.push("cuantia_conflicto_sin_resolver");
  }

  return { data: out, aplicados };
}
