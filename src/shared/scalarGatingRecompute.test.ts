// ============================================================================
// Tests funcionales del recálculo escalar de coherencia en el choke point
// de generación. Cubre el bug "bloqueado para siempre": trámites con
// warnings escalares (`_incoherente`, `_no_legible` de coherencia)
// persistidos en `_coherencia_warnings` cuyo valor real EDITADO por el
// humano ya no dispara la incoherencia. El recálculo efímero los saca
// de la lista de motivos sin tocar la persistencia.
//
// Ver también:
//  - supabase/functions/_shared/isomorphic/scalarGatingRecompute.ts
//  - src/shared/mergeRegenPayload.test.ts (mismo patrón de imports).
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  filterMotivosByScalarRecompute,
  recomputeScalarCoherenceForGating,
  SCALAR_COHERENCE_GATING_CODES,
} from "../../supabase/functions/_shared/isomorphic/scalarGatingRecompute";
import {
  applyManualOverrideExceptions,
  MANUAL_OVERRIDE_RULES,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/hardBlockRules";

/** Helper: simula el detector real (filtro hard-block + recálculo escalar +
 *  excepciones Manual>OCR) sin importar el edge function completo (que trae
 *  imports Deno-only). Refleja fielmente el orden de operaciones nuevo en
 *  `procesar-cancelacion/index.ts::detectRequiereRevisionManual`. */
function simulateDetector(
  data: any,
  persistedWarnings: string[],
  manualReviewConfirmed: boolean,
) {
  let motivos = [...persistedWarnings];
  motivos = filterMotivosByScalarRecompute(motivos, {
    poder_banco: data.poder_banco,
    partes: data.partes ?? null,
  });
  if (manualReviewConfirmed) {
    motivos = applyManualOverrideExceptions(motivos, data);
  }
  return { motivos, requiere: motivos.length > 0 };
}

// ── Parte A: recálculo escalar ─────────────────────────────────────────
describe("Parte A — recálculo escalar de coherencia", () => {
  it("1. escritura_num_incoherente: edición coincide con instrumento_poder → destraba", () => {
    const data = {
      poder_banco: {
        apoderado_escritura: "3866", // editado a coincidir
        instrumento_poder: { escritura_num: "3866" },
      },
    };
    const persisted = ["escritura_num_incoherente"];
    const r = simulateDetector(data, persisted, false);
    expect(r.motivos).not.toContain("escritura_num_incoherente");
    expect(r.requiere).toBe(false);
  });

  it("2. escritura_num_incoherente: valores todavía discrepantes → sigue bloqueado", () => {
    const data = {
      poder_banco: {
        apoderado_escritura: "9999",
        instrumento_poder: { escritura_num: "3866" },
      },
    };
    const persisted = ["escritura_num_incoherente"];
    const r = simulateDetector(data, persisted, false);
    expect(r.motivos).toContain("escritura_num_incoherente");
    expect(r.requiere).toBe(true);
  });

  it("3. poder_entidad_nit_incoherente: humano corrige poderdante.entidad_nit a coincidir con partes.banco_nit → destraba", () => {
    const data = {
      poder_banco: {
        poderdante: { entidad_nit: "860.034.313-7", entidad_nombre: "DAVIVIENDA" },
      },
      partes: { banco_nit: "860034313-7", banco_acreedor: "BANCO DAVIVIENDA S.A." },
    };
    const r = simulateDetector(data, ["poder_entidad_nit_incoherente"], false);
    expect(r.motivos).not.toContain("poder_entidad_nit_incoherente");
    expect(r.requiere).toBe(false);
  });

  it("4. fecha_incoherente: años que coinciden tras la edición → destraba", () => {
    const data = {
      poder_banco: {
        apoderado_fecha: "QUINCE (15) DE ENERO DE DOS MIL VEINTICUATRO (2024)",
        instrumento_poder: { fecha: "2024-01-15" },
      },
    };
    const r = simulateDetector(data, ["fecha_incoherente"], false);
    expect(r.motivos).not.toContain("fecha_incoherente");
  });

  it("5. apoderado_cedula_no_legible: cédula editada a valor legible → destraba", () => {
    const data = {
      poder_banco: {
        apoderado_cedula: "52123456", // ya no dice NO_LEGIBLE
        apoderado: { cedula: "52123456" },
      },
    };
    const r = simulateDetector(data, ["apoderado_cedula_no_legible"], false);
    expect(r.motivos).not.toContain("apoderado_cedula_no_legible");
  });

  it("6. otros warnings persistidos no gating pasan intactos por Parte A", () => {
    const data = { poder_banco: {} };
    // Warning no incluido en SCALAR_COHERENCE_GATING_CODES.
    const r = simulateDetector(data, ["rl_banco_menciones_incoherentes"], false);
    expect(r.motivos).toContain("rl_banco_menciones_incoherentes");
  });
});

// ── Parte B: apoderado_cedula_placeholder en MANUAL_OVERRIDE_RULES ─────
describe("Parte B — apoderado_cedula_placeholder", () => {
  it("7. edición a placeholder conocido (79.123.456) → NO se suprime", () => {
    const data = {
      poder_banco: {
        apoderado_cedula: "79.123.456", // placeholder de PODER_CEDULAS_PLACEHOLDER
      },
    };
    const r = simulateDetector(data, ["apoderado_cedula_placeholder"], true);
    expect(r.motivos).toContain("apoderado_cedula_placeholder");
  });

  it("8. edición a cédula real válida → SÍ se suprime bajo manualReviewConfirmed", () => {
    const data = {
      poder_banco: { apoderado_cedula: "52.123.456" },
    };
    const r = simulateDetector(data, ["apoderado_cedula_placeholder"], true);
    expect(r.motivos).not.toContain("apoderado_cedula_placeholder");
  });

  it("9. edición a cédula real válida SIN manualReviewConfirmed → sigue bloqueado", () => {
    // Placeholder NO está en SCALAR_COHERENCE_GATING_CODES → Parte A no lo toca.
    // Sin manualReviewConfirmed, applyManualOverrideExceptions no corre.
    const data = { poder_banco: { apoderado_cedula: "52.123.456" } };
    const r = simulateDetector(data, ["apoderado_cedula_placeholder"], false);
    expect(r.motivos).toContain("apoderado_cedula_placeholder");
  });
});

// ── Regresión de los 4 arreglados hoy ──────────────────────────────────
describe("Regresión — los 4 warnings _menciones_incoherentes ya arreglados", () => {
  it("10. rl_banco_menciones_incoherentes: sigue destrabando por MANUAL_OVERRIDE_RULES", () => {
    const data = {
      poder_banco: {
        poderdante: { representante_legal_cedula: "79392406" },
      },
    };
    const r = simulateDetector(data, ["rl_banco_menciones_incoherentes"], true);
    expect(r.motivos).not.toContain("rl_banco_menciones_incoherentes");
  });

  it("11. ortogonalidad: código escalar no resuelto + manualReviewConfirmed → sigue bloqueado", () => {
    const data = {
      poder_banco: {
        apoderado_escritura: "9999",
        instrumento_poder: { escritura_num: "3866" },
      },
    };
    const r = simulateDetector(data, ["escritura_num_incoherente"], true);
    expect(r.motivos).toContain("escritura_num_incoherente");
  });
});

// ── Recálculo directo ──────────────────────────────────────────────────
describe("recomputeScalarCoherenceForGating — API directa", () => {
  it("devuelve set vacío cuando datos limpios", () => {
    const s = recomputeScalarCoherenceForGating({ poder_banco: {}, partes: null });
    expect(s.size).toBe(0);
  });

  it("solo emite códigos dentro de SCALAR_COHERENCE_GATING_CODES", () => {
    const s = recomputeScalarCoherenceForGating({
      poder_banco: {
        apoderado_escritura: "1000",
        instrumento_poder: { escritura_num: "2000" },
      },
    });
    for (const code of s) {
      expect(SCALAR_COHERENCE_GATING_CODES as readonly string[]).toContain(code);
    }
    expect(s.has("escritura_num_incoherente")).toBe(true);
  });
});

// ── Contrato del catálogo ──────────────────────────────────────────────
describe("Catálogo — no overlap entre Parte A y Parte B", () => {
  it("apoderado_cedula_placeholder NO está en SCALAR_COHERENCE_GATING_CODES", () => {
    expect(SCALAR_COHERENCE_GATING_CODES as readonly string[])
      .not.toContain("apoderado_cedula_placeholder");
  });

  it("apoderado_cedula_placeholder SÍ está en MANUAL_OVERRIDE_RULES", () => {
    expect(MANUAL_OVERRIDE_RULES.map((r) => r.warning))
      .toContain("apoderado_cedula_placeholder");
  });
});
