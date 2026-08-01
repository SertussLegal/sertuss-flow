// ============================================================================
// Desempate determinista de cuantía — casos sintéticos.
// Valida `detectarConflictoCuantia` + su cobertura hard-block / override.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  detectarConflictoCuantia,
  buildCuantiaCandidatosUi,
  CUANTIA_CONFLICTO_WARNING,
  CUANTIA_CONFLICTO_ORIGEN,
  type CuantiaCandidatoLike,
} from "../../supabase/functions/_shared/isomorphic/cuantiaConflicto";
import { isHardBlockCoherenciaWarning } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";
import { applyManualOverrideExceptions } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/hardBlockRules";

const c = (
  clasificacion: string,
  monto: number | null,
  extra: Partial<CuantiaCandidatoLike> = {},
): CuantiaCandidatoLike => ({ clasificacion, monto, texto_fragmento: "…", ...extra });

describe("buildCuantiaCandidatosUi", () => {
  it("sólo cuantia_credito, ordenado descendente por monto", () => {
    expect(
      buildCuantiaCandidatosUi([
        c("cuantia_credito", 7968114, { texto_fragmento: "saldo", pagina_aprox: 36 }),
        c("precio_venta", 65000000),
        c("cuantia_credito", 31113670, { texto_fragmento: "mutuo", pagina_aprox: 1 }),
      ]),
    ).toEqual([
      { monto: 31113670, texto_fragmento: "mutuo", pagina_aprox: 1 },
      { monto: 7968114, texto_fragmento: "saldo", pagina_aprox: 36 },
    ]);
  });

  it("deduplica por monto conservando el primer fragmento", () => {
    expect(
      buildCuantiaCandidatosUi([
        c("cuantia_credito", 8558475, { texto_fragmento: "primero" }),
        c("cuantia_credito", 8558475, { texto_fragmento: "segundo" }),
      ]),
    ).toEqual([{ monto: 8558475, texto_fragmento: "primero", pagina_aprox: null }]);
  });

  it("ignora montos null/0 y entradas vacías", () => {
    expect(
      buildCuantiaCandidatosUi([c("cuantia_credito", null), c("cuantia_credito", 0)]),
    ).toEqual([]);
    expect(buildCuantiaCandidatosUi([])).toEqual([]);
    expect(buildCuantiaCandidatosUi(undefined)).toEqual([]);
    expect(buildCuantiaCandidatosUi(null)).toEqual([]);
  });
});


describe("detectarConflictoCuantia", () => {
  it("1 — un solo candidato cuantia_credito con monto → sin conflicto", () => {
    const r = detectarConflictoCuantia([
      c("cuantia_credito", 31113670),
      c("precio_venta", 65000000),
      c("avaluo", 12400000),
    ]);
    expect(r.conflicto).toBe(false);
    expect(r.montosDistintos).toEqual([31113670]);
  });

  it("2 — varios candidatos cuantia_credito con el MISMO monto → sin conflicto (regresión 50d5488a)", () => {
    const r = detectarConflictoCuantia(
      Array.from({ length: 6 }, () => c("cuantia_credito", 8558475)),
    );
    expect(r.conflicto).toBe(false);
    expect(r.montosDistintos).toEqual([8558475]);
  });

  it("3 — 2 candidatos cuantia_credito con montos DISTINTOS → conflicto (caso 982af289)", () => {
    const r = detectarConflictoCuantia([
      c("cuantia_credito", 31113670),
      c("cuantia_credito", 7968114),
    ]);
    expect(r.conflicto).toBe(true);
    expect(r.montosDistintos.sort((a, b) => a - b)).toEqual([7968114, 31113670]);
  });

  it("4 — montos null/0 se ignoran y no cuentan para el conflicto", () => {
    const r = detectarConflictoCuantia([
      c("cuantia_credito", null),
      c("cuantia_credito", 0),
      c("cuantia_credito", 25000000),
      c("uvr_upac", null),
    ]);
    expect(r.conflicto).toBe(false);
    expect(r.montosDistintos).toEqual([25000000]);
  });

  it("5 — cero candidatos cuantia_credito → sin conflicto", () => {
    expect(detectarConflictoCuantia([]).conflicto).toBe(false);
    expect(detectarConflictoCuantia(undefined).conflicto).toBe(false);
    expect(detectarConflictoCuantia(null).conflicto).toBe(false);
    expect(
      detectarConflictoCuantia([c("precio_venta", 65000000), c("avaluo", 1)]).conflicto,
    ).toBe(false);
  });

  it("montos distintos de otras clasificaciones nunca generan conflicto", () => {
    const r = detectarConflictoCuantia([
      c("precio_venta", 65000000),
      c("subsidio", 7000000),
      c("abono_saldo", 3000000),
    ]);
    expect(r.conflicto).toBe(false);
    expect(r.montosDistintos).toEqual([]);
  });
});

describe("hard-block del conflicto de cuantía", () => {
  it("el warning es hard-block", () => {
    expect(isHardBlockCoherenciaWarning(CUANTIA_CONFLICTO_WARNING)).toBe(true);
    expect(CUANTIA_CONFLICTO_ORIGEN).toBe("conflicto_candidatos_no_resuelto");
  });

  it("sigue bloqueando si el humano no escribió un monto real", () => {
    const data = {
      hipoteca_anterior: {
        valor_hipoteca_original: "",
        valor_hipoteca_es_indeterminada: true,
        cuantia_origen: CUANTIA_CONFLICTO_ORIGEN,
      },
    };
    expect(applyManualOverrideExceptions([CUANTIA_CONFLICTO_WARNING], data)).toEqual([
      CUANTIA_CONFLICTO_WARNING,
    ]);
  });

  it("se suprime cuando el humano escribió el monto correcto", () => {
    const data = {
      hipoteca_anterior: {
        valor_hipoteca_original:
          "TREINTA Y UN MILLONES CIENTO TRECE MIL SEISCIENTOS SETENTA PESOS ($31.113.670)",
        valor_hipoteca_es_indeterminada: false,
      },
    };
    expect(applyManualOverrideExceptions([CUANTIA_CONFLICTO_WARNING], data)).toEqual([]);
  });

  it("se suprime cuando el humano marca el origen como manual", () => {
    const data = {
      hipoteca_anterior: {
        valor_hipoteca_original: "",
        valor_hipoteca_es_indeterminada: true,
        cuantia_origen: "manual",
      },
    };
    expect(applyManualOverrideExceptions([CUANTIA_CONFLICTO_WARNING], data)).toEqual([]);
  });
});
