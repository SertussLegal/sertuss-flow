// Tests del selector determinista de nomenclatura catastral por índice más
// alto. Cubre el caso ancla real (Alejandra, cancelación
// 1c63c1aa-9291-4db4-815d-021ad5298857) y los invariantes documentados en
// `blindaje-anti-transposicion-ocr` §4.
import { describe, it, expect } from "vitest";
import {
  parseIndice,
  normalizeForCompare,
  selectDireccionPorIndice,
  type DireccionCandidata,
} from "../../supabase/functions/_shared/isomorphic/direccionCandidatasSelect";
import { isHardBlockCoherenciaWarning } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

describe("parseIndice", () => {
  it("arábigo simple", () => {
    expect(parseIndice("1")).toBe(1);
    expect(parseIndice("2")).toBe(2);
    expect(parseIndice("10")).toBe(10);
  });
  it("tolera sufijos ')' y espacios", () => {
    expect(parseIndice("1) ")).toBe(1);
    expect(parseIndice("  3.")).toBe(3);
  });
  it("romanos", () => {
    expect(parseIndice("I")).toBe(1);
    expect(parseIndice("II")).toBe(2);
    expect(parseIndice("iii")).toBe(3);
    expect(parseIndice("IV")).toBe(4);
    expect(parseIndice("IX")).toBe(9);
    expect(parseIndice("XX")).toBe(20);
  });
  it("rechaza basura", () => {
    expect(parseIndice("a")).toBeNull();
    expect(parseIndice("?")).toBeNull();
    expect(parseIndice("")).toBeNull();
    expect(parseIndice(null)).toBeNull();
    expect(parseIndice("100")).toBeNull(); // fuera de rango notarial
  });
});

describe("normalizeForCompare", () => {
  it("strip catastral + coletilla + colapso de espacios", () => {
    const a = "KR 92 8 18 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA";
    const b = "  KR 92 8 18   ";
    expect(normalizeForCompare(a)).toBe(normalizeForCompare(b));
  });
  it("13C-05 vs 13C-09 DEBEN divergir (no fuzzy)", () => {
    expect(normalizeForCompare("KR 104 13C-05 CA 119"))
      .not.toBe(normalizeForCompare("KR 104 13C-09 CA 119"));
  });
});

const mk = (arr: DireccionCandidata[]) => arr;

describe("selectDireccionPorIndice", () => {
  it("1. Caso ancla Alejandra: (1) y (2), modelo eligió (1), selector devuelve (2) + warning", () => {
    const candidatas = mk([
      { indice: "1", valor: "CALLE DIEZ NÚMERO NOVENTA Y UNO - UNO APARTAMENTO CERO CIENTO DIECIOCHO TORRE CINCO (10 No. 91-01 Apto 0118 T5)" },
      { indice: "2", valor: "CARRERA NOVENTA Y DOS NÚMERO OCHO - DIECIOCHO TORRE CINCO APARTAMENTO CIENTO DIECIOCHO (92 No. 8-18 T5 Ap 118)" },
    ]);
    const modelo = "CALLE DIEZ NÚMERO NOVENTA Y UNO - UNO APARTAMENTO CERO CIENTO DIECIOCHO TORRE CINCO (10 No. 91-01 Apto 0118 T5)";
    const r = selectDireccionPorIndice(candidatas, modelo);
    expect(r.indiceGanador).toBe(2);
    expect(r.seleccionada).toMatch(/CARRERA NOVENTA Y DOS/);
    expect(r.divergeDelModelo).toBe(true);
    expect(r.warnings).toContain("direccion_indice_corregido_por_codigo");
    expect(r.suspicious.has("inmueble.nomenclatura_predio")).toBe(true);
    expect(r.suspicious.has("inmueble.direccion_candidatas")).toBe(true);
  });

  it("2. Numeración romana: III gana sobre II y I", () => {
    const r = selectDireccionPorIndice(
      mk([
        { indice: "I", valor: "A" },
        { indice: "II", valor: "B" },
        { indice: "III", valor: "C" },
      ]),
      "C",
    );
    expect(r.indiceGanador).toBe(3);
    expect(r.seleccionada).toBe("C");
    expect(r.divergeDelModelo).toBe(false);
  });

  it("3. Empate en mismo índice → última aparición gana", () => {
    const r = selectDireccionPorIndice(
      mk([
        { indice: "2", valor: "A" },
        { indice: "2", valor: "B" },
      ]),
      "B",
    );
    expect(r.seleccionada).toBe("B");
    expect(r.indiceGanador).toBe(2);
  });

  it("4. Array undefined → seleccionada undefined, sin warnings (fallback silencioso, dato histórico)", () => {
    const r = selectDireccionPorIndice(undefined, "CUALQUIER COSA");
    expect(r.seleccionada).toBeUndefined();
    expect(r.warnings).toEqual([]);
    expect(r.suspicious.size).toBe(0);
  });

  it("5. Array vacío → idem", () => {
    const r = selectDireccionPorIndice([], "CUALQUIER COSA");
    expect(r.seleccionada).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("6. 1 sola candidata coincidente con el modelo → no diverge", () => {
    const r = selectDireccionPorIndice(
      mk([{ indice: "1", valor: "CARRERA 92 No. 8-18" }]),
      "CARRERA 92 No. 8-18 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA",
    );
    expect(r.seleccionada).toBe("CARRERA 92 No. 8-18");
    expect(r.divergeDelModelo).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("7. 1 sola candidata pero el modelo emitió algo distinto → warning dispara", () => {
    const r = selectDireccionPorIndice(
      mk([{ indice: "1", valor: "KR 92 8 18" }]),
      "CL 10 91 01",
    );
    expect(r.divergeDelModelo).toBe(true);
    expect(r.warnings).toContain("direccion_indice_corregido_por_codigo");
  });

  it("8. Índices no parseables se filtran; si todos son inválidos → undefined", () => {
    const r = selectDireccionPorIndice(
      mk([
        { indice: "a)", valor: "X" },
        { indice: "?", valor: "Y" },
      ]),
      "Z",
    );
    expect(r.seleccionada).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("9. Valor NULLY_MENCION se filtra", () => {
    const r = selectDireccionPorIndice(
      mk([
        { indice: "1", valor: "KR 92 8 18" },
        { indice: "2", valor: "NO_LEGIBLE" },
      ]),
      "KR 92 8 18",
    );
    // el (2) se filtra, gana el (1); modelo coincide → no diverge
    expect(r.indiceGanador).toBe(1);
    expect(r.seleccionada).toBe("KR 92 8 18");
    expect(r.divergeDelModelo).toBe(false);
  });

  it("10. Comparación tolera coletilla catastral y coletilla de ciudad", () => {
    const r = selectDireccionPorIndice(
      mk([{ indice: "2", valor: "KR 92 8 18" }]),
      "KR 92 8 18 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C. DEPARTAMENTO DE CUNDINAMARCA",
    );
    expect(r.divergeDelModelo).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("11. El warning NO es hard-block (informativo/ámbar, no bloquea generación)", () => {
    expect(isHardBlockCoherenciaWarning("direccion_indice_corregido_por_codigo"))
      .toBe(false);
  });
});
