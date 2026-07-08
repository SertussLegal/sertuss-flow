// Hard-block + duplicidad cruzada + placeholder (auditoría 2026-07-08).
// Cubre las 3 puertas que decían ausentes:
//   1) Placeholder de cédula (79.123.456 / 41.939.243) → warning.
//   2) Duplicidad cruzada nombre↔cédula → warnings.
//   3) `isHardBlockCoherenciaWarning` clasifica correctamente.
import { describe, it, expect } from "vitest";
import {
  validatePoderBancoCoherencia,
  isHardBlockCoherenciaWarning,
  PODER_CEDULAS_PLACEHOLDER,
  normalizeCedula,
  HARD_BLOCK_WARNING_SUFFIXES,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";
import {
  detectDuplicidadCruzada,
  normalizeNombreApoderado,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/crossCheck";

describe("normalizeCedula", () => {
  it("normaliza puntos y espacios", () => {
    expect(normalizeCedula("79.123.456")).toBe("79123456");
    expect(normalizeCedula("  41 939 243  ")).toBe("41939243");
    expect(normalizeCedula(null)).toBe("");
  });
});

describe("PODER_CEDULAS_PLACEHOLDER", () => {
  it("contiene solo el placeholder confirmado empíricamente", () => {
    expect(PODER_CEDULAS_PLACEHOLDER.has("79123456")).toBe(true);
    // 41939243 es cédula REAL (caso Armenia) — no debe estar en la lista.
    expect(PODER_CEDULAS_PLACEHOLDER.has("41939243")).toBe(false);
  });
});

describe("isHardBlockCoherenciaWarning", () => {
  it("acepta todos los sufijos de HARD_BLOCK_WARNING_SUFFIXES", () => {
    expect(HARD_BLOCK_WARNING_SUFFIXES.length).toBeGreaterThan(0);
    expect(isHardBlockCoherenciaWarning("escritura_num_incoherente")).toBe(true);
    expect(isHardBlockCoherenciaWarning("fecha_incoherente")).toBe(true);
    expect(isHardBlockCoherenciaWarning("apoderado_cedula_no_legible")).toBe(true);
    expect(isHardBlockCoherenciaWarning("apoderado_cedula_placeholder")).toBe(true);
    expect(isHardBlockCoherenciaWarning("apoderado_nombre_duplicidad_cruzada")).toBe(true);
    expect(isHardBlockCoherenciaWarning("apoderado_cedula_duplicidad_cruzada")).toBe(true);
  });
  it("rechaza warnings no bloqueantes", () => {
    expect(isHardBlockCoherenciaWarning("cedula_formato_invalido")).toBe(false);
    expect(isHardBlockCoherenciaWarning("apoderado_coincide_con_rl_banco")).toBe(false);
    expect(isHardBlockCoherenciaWarning(null)).toBe(false);
    expect(isHardBlockCoherenciaWarning(undefined)).toBe(false);
  });
});

describe("validatePoderBancoCoherencia — placeholder", () => {
  it("dispara apoderado_cedula_placeholder cuando la cédula plana coincide con 79.123.456", () => {
    const res = validatePoderBancoCoherencia({
      apoderado_nombre: "CUALQUIERA",
      apoderado_cedula: "79.123.456",
    });
    expect(res.warnings).toContain("apoderado_cedula_placeholder");
    expect(res.suspicious.has("apoderado_cedula")).toBe(true);
  });
  it("no dispara placeholder si la cédula es normal", () => {
    const res = validatePoderBancoCoherencia({
      apoderado_nombre: "X",
      apoderado_cedula: "52.219.803",
    });
    expect(res.warnings).not.toContain("apoderado_cedula_placeholder");
  });
});

describe("detectDuplicidadCruzada", () => {
  const nombreDistintoMismaCed = [
    { id: "row-1", apoderado_nombre: "FELIX DE JESUS CAGUA", apoderado_cedula: "79.123.456" },
  ];
  it("Regla B — misma cédula, nombre distinto", () => {
    const res = detectDuplicidadCruzada(
      { apoderado_nombre: "ANA MARIA MONTOYA ECHEVERRY", apoderado_cedula: "79123456" },
      nombreDistintoMismaCed,
    );
    expect(res.warnings).toContain("apoderado_cedula_duplicidad_cruzada");
    expect(res.matches).toEqual(["row-1"]);
    expect(res.suspicious.has("apoderado_cedula")).toBe(true);
    expect(res.suspicious.has("apoderado_nombre")).toBe(true);
  });

  it("Regla A — mismo nombre, cédula distinta", () => {
    const previas = [
      { id: "row-2", apoderado_nombre: "ANA MARIA MONTOYA ECHEVERRY", apoderado_cedula: "41.944.755" },
    ];
    const res = detectDuplicidadCruzada(
      { apoderado_nombre: "Ana Maria Montoya Echeverry", apoderado_cedula: "41525143" },
      previas,
    );
    expect(res.warnings).toContain("apoderado_nombre_duplicidad_cruzada");
    expect(res.matches).toEqual(["row-2"]);
  });

  it("No dispara si nombre y cédula coinciden con previa (misma persona)", () => {
    const res = detectDuplicidadCruzada(
      { apoderado_nombre: "JUAN PEREZ", apoderado_cedula: "79.111.222" },
      [{ id: "r", apoderado_nombre: "JUAN PEREZ", apoderado_cedula: "79111222" }],
    );
    expect(res.warnings).toEqual([]);
    expect(res.matches).toEqual([]);
  });

  it("No dispara si falta cédula en el actual (evita falsos positivos)", () => {
    const res = detectDuplicidadCruzada(
      { apoderado_nombre: "ANA MARIA MONTOYA ECHEVERRY", apoderado_cedula: null },
      [{ id: "r", apoderado_nombre: "ANA MARIA MONTOYA ECHEVERRY", apoderado_cedula: "111" }],
    );
    expect(res.warnings).toEqual([]);
  });

  it("normalizeNombreApoderado quita acentos, colapsa espacios y sube a mayúsculas", () => {
    expect(normalizeNombreApoderado("  Ánderson  López  ")).toBe("ANDERSON LOPEZ");
  });
});
