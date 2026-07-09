// Fase 2 — Coherencia intra-trámite: poder_banco.poderdante vs partes.banco_*
// Cubre el escenario: poder auténtico e internamente coherente, pero que
// autoriza sobre banco DISTINTO al acreedor real de la escritura hipotecaria.
import { describe, it, expect } from "vitest";
import { validatePoderVsCancelacion } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validateIntraTramite";
import {
  HARD_BLOCK_WARNING_SUFFIXES,
  isHardBlockCoherenciaWarning,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

const poderdante = (extra: Record<string, unknown>) => ({
  poderdante: { entidad_nit: null, entidad_nombre: null, ...extra },
});

describe("validatePoderVsCancelacion — Fase 2 intra-trámite", () => {
  it("1. Regla 1: NIT distinto → dispara poder_entidad_nit_incoherente", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nit: "860034313-7", entidad_nombre: "BANCO DAVIVIENDA S.A." }),
      { banco_nit: "890903938-8", banco_acreedor: "BANCOLOMBIA S.A." },
    );
    expect(r.warnings).toContain("poder_entidad_nit_incoherente");
    expect(r.suspicious.has("poderdante.entidad_nit")).toBe(true);
    expect(r.suspicious.has("partes.banco_nit")).toBe(true);
  });

  it("2. Regla 1: NIT igual (formatos distintos) → NO dispara", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nit: "860034313-7", entidad_nombre: "DAVIVIENDA" }),
      { banco_nit: "860.034.313-7", banco_acreedor: "BANCO DAVIVIENDA S.A." },
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("3. Regla 2: NIT faltante en poder + nombres distintos → dispara fuzzy", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nombre: "BANCOLOMBIA S.A." }),
      { banco_nit: "860.034.313-7", banco_acreedor: "BANCO DAVIVIENDA S.A." },
    );
    expect(r.warnings).toContain("poder_entidad_nombre_incoherente");
    expect(r.suspicious.has("poderdante.entidad_nombre")).toBe(true);
    expect(r.suspicious.has("partes.banco_acreedor")).toBe(true);
  });

  it("4. Regla 2: NIT faltante + nombres similares (DAVIVIENDA vs BANCO DAVIVIENDA S.A.) → NO dispara", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nombre: "DAVIVIENDA" }),
      { banco_acreedor: "BANCO DAVIVIENDA S.A." },
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("5. Ambos NIT presentes + coinciden, nombres diferentes → NO doble-dispara (Regla 2 no corre)", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nit: "860034313-7", entidad_nombre: "DAVIVIENDA" }),
      { banco_nit: "860.034.313-7", banco_acreedor: "OTRO NOMBRE COMPLETAMENTE DISTINTO" },
    );
    expect(r.warnings).toHaveLength(0);
  });

  it("6. Ambos NIT presentes + distintos → dispara Regla 1, ignora Regla 2 aunque nombres también difieran", () => {
    const r = validatePoderVsCancelacion(
      poderdante({ entidad_nit: "111", entidad_nombre: "BANCOLOMBIA" }),
      { banco_nit: "222", banco_acreedor: "DAVIVIENDA" },
    );
    expect(r.warnings).toEqual(["poder_entidad_nit_incoherente"]);
  });

  it("7. Contrato HARD_BLOCK: ambos warnings terminan en _incoherente y son HARD_BLOCK", () => {
    expect(HARD_BLOCK_WARNING_SUFFIXES).toContain("_incoherente");
    expect(isHardBlockCoherenciaWarning("poder_entidad_nit_incoherente")).toBe(true);
    expect(isHardBlockCoherenciaWarning("poder_entidad_nombre_incoherente")).toBe(true);
  });
});
