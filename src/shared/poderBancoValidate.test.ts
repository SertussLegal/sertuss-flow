// Validación determinista de coherencia del bloque poder_banco (Parte 2
// del endurecimiento V6). Cubre las 4 reglas y los 2 casos reales de Ana
// María como fixtures de regresión.
import { describe, it, expect } from "vitest";
import {
  validatePoderBancoCoherencia,
  extractEscrituraDigits,
  extractYear,
  isCedulaValida,
  isNoLegible,
  WARNING_LABELS,
  SUSPICIOUS_FIELD_LABELS,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";
import { mergePoderBancoV6 } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/merge";

describe("extractEscrituraDigits", () => {
  it("extrae del paréntesis final", () => {
    expect(extractEscrituraDigits("TRESCIENTOS SESENTA Y CUATRO (364)")).toBe("364");
  });
  it("acepta dígitos crudos", () => {
    expect(extractEscrituraDigits("2814")).toBe("2814");
  });
  it("devuelve undefined si no hay dígitos", () => {
    expect(extractEscrituraDigits("")).toBeUndefined();
    expect(extractEscrituraDigits(null)).toBeUndefined();
    expect(extractEscrituraDigits("SIN NUMERO")).toBeUndefined();
  });
});

describe("extractYear", () => {
  it("acepta ISO", () => expect(extractYear("2024-01-15")).toBe("2024"));
  it("acepta español notarial", () =>
    expect(extractYear("QUINCE (15) DE ENERO DE DOS MIL VEINTICUATRO (2024)")).toBe("2024"));
  it("devuelve undefined si no hay año", () => {
    expect(extractYear("")).toBeUndefined();
    expect(extractYear(null)).toBeUndefined();
  });
});

describe("isCedulaValida", () => {
  it("acepta 6-10 dígitos", () => {
    expect(isCedulaValida("52219803")).toBe(true);
    expect(isCedulaValida("41.939.243")).toBe(true);
    expect(isCedulaValida("123456")).toBe(true);
    expect(isCedulaValida("1234567890")).toBe(true);
  });
  it("rechaza guiones y letras", () => {
    expect(isCedulaValida("521639-4")).toBe(false);
    expect(isCedulaValida("ABC123")).toBe(false);
  });
  it("rechaza <6 y >10 dígitos", () => {
    expect(isCedulaValida("12345")).toBe(false);
    expect(isCedulaValida("12345678901")).toBe(false);
  });
  it("ausencia (vacío/null) NO es inválida", () => {
    expect(isCedulaValida(undefined)).toBe(true);
    expect(isCedulaValida(null)).toBe(true);
    expect(isCedulaValida("")).toBe(true);
  });
});

describe("validatePoderBancoCoherencia — payload vacío/null", () => {
  it("no warnings para null/undefined", () => {
    expect(validatePoderBancoCoherencia(null).warnings).toEqual([]);
    expect(validatePoderBancoCoherencia(undefined).warnings).toEqual([]);
    expect(validatePoderBancoCoherencia({}).warnings).toEqual([]);
  });
});

describe("Regla 1 — escritura incoherente", () => {
  it("detecta 2814 vs 364", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      apoderado_escritura: "TRESCIENTOS SESENTA Y CUATRO (364)",
      instrumento_poder: { escritura_num: "2814" },
    });
    expect(warnings).toContain("escritura_num_incoherente");
    expect(suspicious.has("apoderado_escritura")).toBe(true);
    expect(suspicious.has("instrumento_poder.escritura_num")).toBe(true);
  });
  it("no dispara si coinciden", () => {
    const { warnings } = validatePoderBancoCoherencia({
      apoderado_escritura: "DOS MIL OCHOCIENTOS CATORCE (2814)",
      instrumento_poder: { escritura_num: "2814" },
    });
    expect(warnings).not.toContain("escritura_num_incoherente");
  });
  it("no dispara si falta uno", () => {
    const { warnings } = validatePoderBancoCoherencia({
      apoderado_escritura: "2814",
      instrumento_poder: {},
    });
    expect(warnings).not.toContain("escritura_num_incoherente");
  });
});

describe("Regla 2 — fecha (año) incoherente", () => {
  it("detecta 2023 vs 2024", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      apoderado_fecha: "QUINCE (15) DE ENERO DE DOS MIL VEINTITRÉS (2023)",
      instrumento_poder: { fecha: "2024-01-15" },
    });
    expect(warnings).toContain("fecha_incoherente");
    expect(suspicious.has("apoderado_fecha")).toBe(true);
    expect(suspicious.has("instrumento_poder.fecha")).toBe(true);
  });
  it("no dispara si el año coincide", () => {
    const { warnings } = validatePoderBancoCoherencia({
      apoderado_fecha: "QUINCE (15) DE ENERO DE DOS MIL VEINTICUATRO (2024)",
      instrumento_poder: { fecha: "2024-01-15" },
    });
    expect(warnings).not.toContain("fecha_incoherente");
  });
});

describe("Regla 3 — formato cédula inválido", () => {
  it("detecta 521639-4 en apoderado.cedula", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      apoderado: { tipo: "natural", cedula: "521639-4" },
    });
    expect(warnings).toContain("cedula_formato_invalido");
    expect(suspicious.has("apoderado.cedula")).toBe(true);
  });
  it("detecta cédula inválida en representantes[]", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      apoderado: {
        tipo: "juridica",
        representantes: [{ nombre: "X", cedula: "ABC-123" }],
      },
    });
    expect(warnings).toContain("cedula_formato_invalido");
    expect(suspicious.has("apoderado.representantes[0].cedula")).toBe(true);
  });
  it("cédula plano válida no dispara", () => {
    const { warnings } = validatePoderBancoCoherencia({
      apoderado_cedula: "41.939.243",
      apoderado: { tipo: "natural", cedula: "41939243" },
    });
    expect(warnings).not.toContain("cedula_formato_invalido");
  });
});

describe("Regla 4 — apoderado colapsado con RL banco", () => {
  it("detecta la colisión (misma cédula en apoderado y poderdante.RL)", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      apoderado: { tipo: "natural", cedula: "52219803" },
      apoderado_cedula: "52219803",
      poderdante: { representante_legal_cedula: "52219803" },
    });
    expect(warnings).toContain("apoderado_coincide_con_rl_banco");
    expect(suspicious.has("apoderado_cedula")).toBe(true);
    expect(suspicious.has("poderdante.representante_legal_cedula")).toBe(true);
  });
  it("no dispara con cédulas distintas", () => {
    const { warnings } = validatePoderBancoCoherencia({
      apoderado_cedula: "52219803",
      poderdante: { representante_legal_cedula: "79876543" },
    });
    expect(warnings).not.toContain("apoderado_coincide_con_rl_banco");
  });
});

describe("Fixtures reales — casos Ana María (regresión)", () => {
  it("cancelación 15582708: escritura incoherente (2814 vs 364)", () => {
    const merged = {
      apoderado_nombre: "ANA MARIA MONTOYA ECHEVERRY",
      apoderado_cedula: "79.123.456", // monolítico halucinó — pero formato OK con puntos
      apoderado_escritura: "TRESCIENTOS SESENTA Y CUATRO (364)",
      apoderado_fecha: "DIEZ (10) DE OCTUBRE DE DOS MIL VEINTITRÉS (2023)",
      apoderado: { tipo: "natural", nombre: "ANA MARIA MONTOYA ECHEVERRY", cedula: "52219803" },
      instrumento_poder: { escritura_num: "2814", fecha: "2023-10-10" },
    };
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("escritura_num_incoherente");
    expect(suspicious.has("apoderado_escritura")).toBe(true);
  });

  it("cancelación 9a78aebb: formato cédula inválido (521639-4)", () => {
    const merged = {
      apoderado_nombre: "ANA MARIA MONTOYA ECHEVERRY",
      apoderado_cedula: "521639-4",
      apoderado: { tipo: "natural", nombre: "ANA MARIA MONTOYA ECHEVERRY", cedula: "521639-4" },
      instrumento_poder: { escritura_num: "2161", fecha: "2024-05-20" },
    };
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("cedula_formato_invalido");
    expect(suspicious.has("apoderado_cedula")).toBe(true);
    expect(suspicious.has("apoderado.cedula")).toBe(true);
  });
});

describe("Labels", () => {
  it("todos los warnings tienen label", () => {
    for (const w of [
      "escritura_num_incoherente",
      "fecha_incoherente",
      "cedula_formato_invalido",
      "apoderado_coincide_con_rl_banco",
    ]) {
      expect(WARNING_LABELS[w]).toBeTruthy();
    }
  });
  it("los paths sospechosos comunes tienen label", () => {
    expect(SUSPICIOUS_FIELD_LABELS["apoderado_cedula"]).toBeTruthy();
    expect(SUSPICIOUS_FIELD_LABELS["apoderado.cedula"]).toBeTruthy();
    expect(SUSPICIOUS_FIELD_LABELS["instrumento_poder.escritura_num"]).toBeTruthy();
  });
});
