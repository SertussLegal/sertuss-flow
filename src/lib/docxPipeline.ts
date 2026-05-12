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
  materializeDocxRenderData,
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

const PIPELINE_VERSION = "v3.2.materialize";

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
 * Lee una ruta dotted del modelo, probando primero la clave literal con
 * punto en raíz (clave materializada) y luego la ruta anidada.
 * Esto refleja exactamente cómo el render de Word resuelve `{a.b.c}`.
 */
const readDotted = (data: Record<string, unknown>, path: string): unknown => {
  if (path in data) return data[path];
  const parts = path.split(".");
  let cur: unknown = data;
  for (const p of parts) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
};

/**
 * Compara campos críticos UI ↔ pipeline.
 * Usa `readDotted` para validar la MISMA clave que docxtemplater renderiza,
 * incluyendo claves literales con punto materializadas en la raíz.
 */
function runIntegrityCheck(
  ui: ConsolidationInput["ui"],
  data: ConsolidatedDocxData,
): IntegrityFailure[] {
  const failures: IntegrityFailure[] = [];
  const root = data as unknown as Record<string, unknown>;

  const check = (label: string, uiVal: unknown, ...pipePaths: string[]): void => {
    if (normalize(uiVal) === "") return;
    // Pasa si CUALQUIER ruta materializada contiene el dato.
    const ok = pipePaths.some((p) => normalize(readDotted(root, p)) !== "");
    if (!ok) {
      failures.push({ field: label, label, uiValue: String(uiVal) });
    }
  };

  // 1. Inmueble — validar tanto clave raíz como literal con punto.
  check(
    "Matrícula",
    ui.inmueble.matricula_inmobiliaria,
    "matricula_inmobiliaria",
    "matricula",
    "inmueble.matricula",
    "inmueble.matricula_inmobiliaria",
  );
  check(
    "Cédula Catastral",
    ui.inmueble.identificador_predial,
    "cedula_catastral",
    "chip",
    "identificador_predial",
    "inmueble.cedula_catastral",
    "inmueble.chip",
  );
  check(
    "Dirección del inmueble",
    ui.inmueble.direccion,
    "direccion_inmueble",
    "ubicacion_predio",
    "ubicacion_inmueble",
    "inmueble.direccion",
    "inmueble.ubicacion",
  );

  // 2. Actos — claves dotted que el Word usa.
  check(
    "Valor Compraventa",
    ui.actos.valor_compraventa,
    "actos.cuantia_compraventa_numero",
    "actos.cuantia_compraventa_letras",
  );
  if (ui.actos.es_hipoteca) {
    check(
      "Entidad Bancaria",
      ui.actos.entidad_bancaria,
      "actos.entidad_bancaria",
      "entidad_bancaria",
      "banco_nombre",
    );
    check(
      "Valor Hipoteca",
      ui.actos.valor_hipoteca,
      "actos.cuantia_hipoteca_numero",
      "actos.cuantia_hipoteca_letras",
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
      if (normalize(item.nombre_completo) !== "" && normalize(slot?.nombre) === "") {
        failures.push({
          field: type,
          label: `Nombre ${type} #${i + 1}`,
          uiValue: String(item.nombre_completo),
        });
      }
      if (normalize(item.numero_cedula) !== "" && normalize(slot?.cedula) === "") {
        failures.push({
          field: type,
          label: `Cédula ${type} #${i + 1}`,
          uiValue: String(item.numero_cedula),
        });
      }
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
 *
 * Orden v3.2:
 *   1. Consolidar
 *   2. Overrides manuales (escriben anidado + clave literal con punto)
 *   3. Hidratar prosa
 *   4. Auditoría invisible
 *   5. Materialización (clona ramas anidadas como claves dotted en raíz)
 *   6. Integridad UI ↔ pipeline (sobre data materializada)
 *   7. Críticos vacíos
 *   8. Placeholders
 */
export function generateFinalData(
  input: ConsolidationInput,
  ctx: PipelineCtx,
): PipelineResult {
  const version = ctx.pipelineVersion ?? PIPELINE_VERSION;

  let data = getConsolidatedDocxData(input);
  data = applyManualOverrides(data, input.manualFieldOverrides);
  data = hydrateProsa(data);
  data = injectAuditMetadata(data, {
    tramiteId: ctx.tramiteId,
    ts: new Date().toISOString(),
    pipelineVersion: version,
  });

  // Materializar ANTES de la verificación de integridad para que el chequeo
  // valide exactamente lo que docxtemplater va a renderizar.
  data = materializeDocxRenderData(data);

  const integrityFailures = runIntegrityCheck(input.ui, data);

  const tipoActo = input.ui.actos.es_hipoteca
    ? "Compraventa con Hipoteca"
    : input.ui.actos.tipo_acto || "_default";
  const missingCritical = checkCriticalEmpty(data, tipoActo);

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
export const __testables = { normalize, runIntegrityCheck, readDotted };
