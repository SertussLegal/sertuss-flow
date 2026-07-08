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
      "apoderado_cedula_no_legible",
      "escritura_poder_no_legible",
      "fecha_poder_no_legible",
    ]) {
      expect(WARNING_LABELS[w]).toBeTruthy();
    }
  });
  it("los paths sospechosos comunes tienen label", () => {
    expect(SUSPICIOUS_FIELD_LABELS["apoderado_cedula"]).toBeTruthy();
    expect(SUSPICIOUS_FIELD_LABELS["apoderado.cedula"]).toBeTruthy();
    expect(SUSPICIOUS_FIELD_LABELS["instrumento_poder.escritura_num"]).toBeTruthy();
    expect(SUSPICIOUS_FIELD_LABELS["escritura_poder_num"]).toBeTruthy();
    expect(SUSPICIOUS_FIELD_LABELS["fecha_poder"]).toBeTruthy();
    expect(SUSPICIOUS_FIELD_LABELS["instrumento_poder.fecha_texto"]).toBeTruthy();
  });
});

// ============================================================================
// Fase C — Canal NO_LEGIBLE (v7-2026-07-08)
// ============================================================================

describe("isNoLegible", () => {
  it("detecta el centinela literal", () => {
    expect(isNoLegible("NO_LEGIBLE")).toBe(true);
    expect(isNoLegible("  NO_LEGIBLE  ")).toBe(true);
  });
  it("rechaza variantes case/lowercase y valores normales", () => {
    expect(isNoLegible("no_legible")).toBe(false);
    expect(isNoLegible("No_Legible")).toBe(false);
    expect(isNoLegible("41525143")).toBe(false);
    expect(isNoLegible(null)).toBe(false);
    expect(isNoLegible(undefined)).toBe(false);
    expect(isNoLegible("")).toBe(false);
  });
});

describe("Regla 5 — NO_LEGIBLE en cédula del apoderado", () => {
  it("dispara warning cuando el plano viene NO_LEGIBLE", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      apoderado_cedula: "NO_LEGIBLE",
    });
    expect(warnings).toContain("apoderado_cedula_no_legible");
    expect(suspicious.has("apoderado_cedula")).toBe(true);
  });
  it("dispara warning cuando el profundo viene NO_LEGIBLE", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      apoderado: { tipo: "natural", cedula: "NO_LEGIBLE" },
    });
    expect(warnings).toContain("apoderado_cedula_no_legible");
    expect(suspicious.has("apoderado.cedula")).toBe(true);
    expect(suspicious.has("apoderado_cedula")).toBe(false);
  });
});

describe("Regla 5 — NO_LEGIBLE en número de escritura del poder", () => {
  it("dispara warning en escritura_poder_num plano legacy", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      escritura_poder_num: "NO_LEGIBLE",
      instrumento_poder: { escritura_num: "7304" },
    });
    expect(warnings).toContain("escritura_poder_no_legible");
    expect(suspicious.has("escritura_poder_num")).toBe(true);
    expect(suspicious.has("instrumento_poder.escritura_num")).toBe(false);
  });
  it("dispara warning en instrumento_poder.escritura_num", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      instrumento_poder: { escritura_num: "NO_LEGIBLE" },
    });
    expect(warnings).toContain("escritura_poder_no_legible");
    expect(suspicious.has("instrumento_poder.escritura_num")).toBe(true);
  });
});

describe("Regla 5 — NO_LEGIBLE en fecha del poder", () => {
  it("dispara en instrumento_poder.fecha_texto", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      instrumento_poder: { fecha_texto: "NO_LEGIBLE" },
    });
    expect(warnings).toContain("fecha_poder_no_legible");
    expect(suspicious.has("instrumento_poder.fecha_texto")).toBe(true);
  });
  it("dispara en fecha_poder plano legacy", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia({
      fecha_poder: "NO_LEGIBLE",
    });
    expect(warnings).toContain("fecha_poder_no_legible");
    expect(suspicious.has("fecha_poder")).toBe(true);
  });
});

describe("Fixture Ana María — cédula alucinada con formato válido NO dispara Regla 5", () => {
  // Caso real (cancelación 2fb6ba16-…, 08-jul-2026):
  //   cédula OCR: "41525143" (alucinada) vs cédula real: "41.939.243".
  // Regla 5 solo detecta NO_LEGIBLE emitido por el propio modelo — NO puede
  // detectar una alucinación con formato válido. La única defensa contra este
  // caso es que Gemini con el nuevo prompt DECIDA devolver "NO_LEGIBLE" en vez
  // de inventar los dígitos. Este test documenta ese límite de forma explícita.
  it("valor alucinado con formato válido NO genera warning de no legible", () => {
    const { warnings } = validatePoderBancoCoherencia({
      apoderado_cedula: "41525143",
      apoderado: { tipo: "natural", cedula: "41525143" },
    });
    expect(warnings).not.toContain("apoderado_cedula_no_legible");
  });
});

describe("Fixture poder limpio — cero warnings", () => {
  it("payload sin NO_LEGIBLE ni incoherencias no dispara ningún warning", () => {
    const { warnings } = validatePoderBancoCoherencia({
      apoderado_nombre: "JUAN PEREZ",
      apoderado_cedula: "79123456",
      apoderado_escritura: "MIL DOSCIENTOS TREINTA Y CUATRO (1234)",
      apoderado_fecha: "QUINCE (15) DE ENERO DE DOS MIL VEINTICUATRO (2024)",
      apoderado: { tipo: "natural", nombre: "JUAN PEREZ", cedula: "79123456" },
      instrumento_poder: { escritura_num: "1234", fecha: "2024-01-15" },
      poderdante: { representante_legal_cedula: "52219803" },
    });
    expect(warnings).toEqual([]);
  });
});

// ============================================================================
// Fase A — Auditoría de merge V6 con NO_LEGIBLE
// Confirma que el centinela NO se sanea como vacío y sobrevive al pipeline.
// ============================================================================

describe("mergePoderBancoV6 preserva NO_LEGIBLE", () => {
  // HALLAZGO DE AUDITORÍA (Fase A, 2026-07-08): cuando V6 profundo trae
  // `apoderado.cedula = "NO_LEGIBLE"`, el classifier degrada `tipoEfectivo`
  // a `null` (porque "NO_LEGIBLE" no cumple los heurísticos internos de
  // "parece cédula real"). Con `tipoEfectivo === null`, el path V6-wins de
  // merge.ts no sobrescribe el plano monolítico → si hubo un valor plano
  // (potencialmente alucinado por Gemini 2.5 Pro), ese valor sobrevive y
  // la señal NO_LEGIBLE del extractor dedicado se pierde silenciosamente.
  //
  // Ámbito de esta ronda (Plan v7 aprobado): documentar el gap con un test
  // explícito. El fix real (propagar NO_LEGIBLE del deep al plano aunque el
  // classifier degrade) queda para una siguiente ronda de trabajo, no se
  // improvisa aquí. El validador (Regla 5) sigue detectando NO_LEGIBLE en
  // apoderado.cedula (profundo), así que el warning se dispara aunque el
  // plano quede con el valor legacy.
  it("LIMITACIÓN CONOCIDA: NO_LEGIBLE profundo NO sobrescribe plano monolítico", () => {
    const merged = mergePoderBancoV6(
      { apoderado_cedula: "79123456" },
      null,
      {
        apoderado: { tipo: "natural", nombre: "JUAN PEREZ", cedula: "NO_LEGIBLE" },
        apoderado_nombre: { valor: "JUAN PEREZ", confianza: "alta" },
        apoderado_cedula: { valor: "NO_LEGIBLE", confianza: "baja" },
        has_apoderado_banco_v3: "true",
      } as any,
    );
    // Plano legacy sobrevive (limitación conocida).
    expect(merged?.apoderado_cedula).toBe("79123456");
    // Pero el profundo conserva NO_LEGIBLE — validate.ts sí lo detecta.
    expect((merged as any)?.apoderado?.cedula).toBe("NO_LEGIBLE");
    const { warnings } = validatePoderBancoCoherencia(merged as Record<string, unknown>);
    expect(warnings).toContain("apoderado_cedula_no_legible");
  });

  it("NO_LEGIBLE en plano monolítico NO se degrada a undefined (pasa por sanitizeString intacto)", () => {
    const merged = mergePoderBancoV6(
      { apoderado_cedula: "NO_LEGIBLE" },
      { apoderado_cedula: "79123456" },
      null,
    );
    // Sin deepV6, mergePoderBancoFlat toma el plano monolítico primero.
    expect(merged?.apoderado_cedula).toBe("NO_LEGIBLE");
  });

  it("payload validado tras merge dispara apoderado_cedula_no_legible", () => {
    const merged = mergePoderBancoV6(
      undefined,
      null,
      {
        apoderado: { tipo: "natural", nombre: "X", cedula: "NO_LEGIBLE" },
        apoderado_nombre: { valor: "X", confianza: "alta" },
        apoderado_cedula: { valor: "NO_LEGIBLE", confianza: "baja" },
        has_apoderado_banco_v3: "true",
      } as any,
    );
    const { warnings } = validatePoderBancoCoherencia(merged as Record<string, unknown>);
    expect(warnings).toContain("apoderado_cedula_no_legible");
  });
});

  it("NO_LEGIBLE en plano monolítico NO se degrada a undefined (pasa por sanitizeString intacto)", () => {
    const merged = mergePoderBancoV6(
      { apoderado_cedula: "NO_LEGIBLE" },
      { apoderado_cedula: "79123456" },
      null,
    );
    // Sin deepV6, mergePoderBancoFlat toma el plano monolítico primero.
    expect(merged?.apoderado_cedula).toBe("NO_LEGIBLE");
  });

  it("payload validado tras merge dispara apoderado_cedula_no_legible", () => {
    const merged = mergePoderBancoV6(
      undefined,
      null,
      {
        apoderado: { tipo: "natural", nombre: "X", cedula: "NO_LEGIBLE" },
        apoderado_nombre: { valor: "X", confianza: "alta" },
        apoderado_cedula: { valor: "NO_LEGIBLE", confianza: "baja" },
        has_apoderado_banco_v3: "true",
      } as any,
    );
    const { warnings } = validatePoderBancoCoherencia(merged as Record<string, unknown>);
    expect(warnings).toContain("apoderado_cedula_no_legible");
  });
});
