/**
 * docxPipeline — Orquestador único del flujo de datos hacia el `.docx`.
 *
 * Orden inmutable:
 *   1. getConsolidatedDocxData    (modelo crudo, "" en huecos)
 *   2. applyManualOverrides       (propaga a todos los alias vía DOCX_FIELD_MAP)
 *   3. hydrateProsa               (números → letras, fechas → texto legal)
 *   4. injectAuditMetadata        (__sertuss_tramite_id, ts, version)
 *   5. runIntegrityCheck          (UI ↔ pipeline, ANTES de placeholders)
 *   6. checkCriticalEmpty         (advertencia preventiva)
 *   7. ensurePlaceholders         (último paso estético: "" → ___________)
 *
 * `generateFinalData` jamás lanza: devuelve `{ data, diagnostics }`. El
 * caller decide si bloquea (integrityFailures) o solo advierte
 * (missingCritical).
 */

import {
  getConsolidatedDocxData,
  applyManualOverrides,
  injectAuditMetadata,
  ensurePlaceholders,
  type ConsolidatedDocxData,
  type ConsolidationInput,
  type PersonaDocxData,
} from "./docxConsolidation";
import { hydrateProsa } from "./docxProsaHydrator";
import { checkCriticalEmpty, type MissingCriticalField } from "./docxCriticalFields";

export interface IntegrityFailure {
  field: string;
  label: string;
  uiValue: string;
}

export interface PipelineDiagnostics {
  missingCritical: MissingCriticalField[];
  integrityFailures: IntegrityFailure[];
  pipelineVersion: string;
}

export interface PipelineResult {
  data: ConsolidatedDocxData;
  diagnostics: PipelineDiagnostics;
}

export interface PipelineCtx {
  tramiteId: string;
  userId?: string;
  pipelineVersion?: string;
}

const PIPELINE_VERSION = "v3.1.integrity";

/**
 * Normaliza un valor para comparación de integridad.
 * Preserva 0 / false como datos válidos. Trim + drop de underscores.
 */
const normalize = (v: unknown): string => {
  if (v === 0 || v === false) return String(v);
  if (v === null || v === undefined) return "";
  return String(v).trim().replace(/_+/g, "");
};

/**
 * Compara campos críticos UI ↔ pipeline.
 * Regla A — UI con dato + pipeline vacío → falla bloqueante.
 * Regla B — Ambos vacíos → permitido.
 * Regla C — Ambos con dato (formato distinto) → válido.
 */
function runIntegrityCheck(
  ui: ConsolidationInput["ui"],
  data: ConsolidatedDocxData,
): IntegrityFailure[] {
  const failures: IntegrityFailure[] = [];

  const check = (label: string, uiVal: unknown, pipeVal: unknown): void => {
    if (normalize(uiVal) !== "" && normalize(pipeVal) === "") {
      failures.push({ field: label, label, uiValue: String(uiVal) });
    }
  };

  // 1. Campos raíz siempre obligatorios.
  check("Matrícula", ui.inmueble.matricula_inmobiliaria, data.matricula_inmobiliaria);
  check("Cédula Catastral", ui.inmueble.identificador_predial, data.cedula_catastral);
  check("Dirección del inmueble", ui.inmueble.direccion, data.direccion_inmueble);
  check(
    "Valor Compraventa",
    ui.actos.valor_compraventa,
    (data.actos as Record<string, unknown>)?.cuantia_compraventa_numero,
  );

  // 2. Hipoteca (condicional).
  if (ui.actos.es_hipoteca) {
    check(
      "Entidad Bancaria",
      ui.actos.entidad_bancaria,
      (data.actos as Record<string, unknown>)?.entidad_bancaria,
    );
    check(
      "Valor Hipoteca",
      ui.actos.valor_hipoteca,
      (data.actos as Record<string, unknown>)?.cuantia_hipoteca_numero,
    );
  }

  // 3. Arrays personas — mismatch de longitud + chequeo por índice.
  const validateArray = (
    list: Array<Record<string, unknown>>,
    pipeList: PersonaDocxData[] | undefined,
    type: "Vendedor" | "Comprador",
  ): void => {
    const actual = Array.isArray(pipeList) ? pipeList : [];
    if (list.length !== actual.length) {
      failures.push({
        field: type,
        label: `Mismatch de cantidad: ${type}s`,
        uiValue: `UI: ${list.length}, Doc: ${actual.length}`,
      });
    }
    list.forEach((item, i) => {
      const slot = actual[i];
      check(`Nombre ${type} #${i + 1}`, item.nombre_completo, slot?.nombre);
      check(`Cédula ${type} #${i + 1}`, item.numero_cedula, slot?.cedula);
    });
  };
  validateArray(
    ui.vendedores as unknown as Array<Record<string, unknown>>,
    data.vendedores,
    "Vendedor",
  );
  validateArray(
    ui.compradores as unknown as Array<Record<string, unknown>>,
    data.compradores,
    "Comprador",
  );

  return failures;
}

/**
 * Pipeline maestro. NO lanza. El caller debe respetar `diagnostics`.
 */
export function generateFinalData(
  input: ConsolidationInput,
  ctx: PipelineCtx,
): PipelineResult {
  const version = ctx.pipelineVersion ?? PIPELINE_VERSION;

  // 1. Crudo
  let data = getConsolidatedDocxData(input);
  // 2. Overrides manuales (propaga a todos los alias). Pre-hydrator para que
  //    las correcciones del usuario sean las que se conviertan a letras.
  data = applyManualOverrides(data, input.manualFieldOverrides);
  // 3. Prosa notarial (montos en letras, fechas legales)
  data = hydrateProsa(data);
  // 4. Auditoría invisible
  data = injectAuditMetadata(data, {
    tramiteId: ctx.tramiteId,
    ts: new Date().toISOString(),
    pipelineVersion: version,
  });

  // 5. Integridad UI ↔ pipeline (ANTES de placeholders)
  const integrityFailures = runIntegrityCheck(input.ui, data);

  // 6. Críticos vacíos (advertencia preventiva)
  const tipoActo = input.ui.actos.es_hipoteca
    ? "Compraventa con Hipoteca"
    : input.ui.actos.tipo_acto || "_default";
  const missingCritical = checkCriticalEmpty(data, tipoActo);

  // 7. Placeholders (último paso, estético)
  const finalData = ensurePlaceholders(data);

  return {
    data: finalData,
    diagnostics: {
      missingCritical,
      integrityFailures,
      pipelineVersion: version,
    },
  };
}

// Exportado para tests.
export const __testables = { normalize, runIntegrityCheck };
