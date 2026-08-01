// Regla 9 — divergencia entre las dos lecturas independientes (dedicado vs V6).
// Foco: la comparación debe ser JUSTA (los dos prompts piden formatos
// distintos a propósito) y CONSERVADORA (formato no entendido → sin bloqueo).
import { describe, it, expect } from "vitest";
import {
  detectarDivergenciaLecturas,
  normalizeEscrituraNum,
  normalizeFechaComparable,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/divergenciaLecturas";
import {
  validatePoderBancoCoherencia,
  isHardBlockCoherenciaWarning,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

const ded = (o: Record<string, string | null>) => ({
  apoderado_cedula: null,
  apoderado_escritura: null,
  apoderado_fecha: null,
  ...o,
});

describe("normalizeEscrituraNum", () => {
  it("prefiere el último grupo entre paréntesis", () => {
    expect(normalizeEscrituraNum("DOS MIL CUATROCIENTOS QUINCE (2415)")).toBe("2415");
  });
  it("cae a todos los dígitos cuando no hay paréntesis", () => {
    expect(normalizeEscrituraNum("No. 2.415")).toBe("2415");
    expect(normalizeEscrituraNum("16390")).toBe("16390");
  });
  it("descarta ceros a la izquierda y valores no comparables", () => {
    expect(normalizeEscrituraNum("02415")).toBe("2415");
    expect(normalizeEscrituraNum("NO_LEGIBLE")).toBe("");
    expect(normalizeEscrituraNum(null)).toBe("");
    expect(normalizeEscrituraNum("SIN NUMERO")).toBe("");
  });
});

describe("normalizeFechaComparable", () => {
  it("normaliza prosa notarial y DD-MM-AAAA al mismo valor", () => {
    expect(normalizeFechaComparable("DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)"))
      .toBe("2025-08-19");
    expect(normalizeFechaComparable("19-08-2025")).toBe("2025-08-19");
    expect(normalizeFechaComparable("19/08/2025")).toBe("2025-08-19");
  });
  it("acepta ISO y tildes/mayúsculas indistintas", () => {
    expect(normalizeFechaComparable("2025-08-19")).toBe("2025-08-19");
    expect(normalizeFechaComparable("uno (1) de diciembre de dos mil trece (2013)"))
      .toBe("2013-12-01");
  });
  it("devuelve '' ante formato inesperado o ilegible (nunca adivina)", () => {
    expect(normalizeFechaComparable("agosto de 2025")).toBe("");   // sin día
    expect(normalizeFechaComparable("19 de 08 de 2025")).toBe(""); // mes numérico en prosa
    expect(normalizeFechaComparable("32-08-2025")).toBe("");       // día imposible
    expect(normalizeFechaComparable("19-13-2025")).toBe("");       // mes imposible
    expect(normalizeFechaComparable("NO_LEGIBLE")).toBe("");
    expect(normalizeFechaComparable(undefined)).toBe("");
  });
});

describe("detectarDivergenciaLecturas", () => {
  it("cédula: mismo número con y sin puntos NO diverge", () => {
    const r = detectarDivergenciaLecturas(ded({ apoderado_cedula: "79.123.456" }), "79123456", null, null);
    expect(r.apoderado_cedula).toBeUndefined();
  });
  it("cédula: transposición de dígitos SÍ diverge", () => {
    const r = detectarDivergenciaLecturas(ded({ apoderado_cedula: "79.123.456" }), "79123465", null, null);
    expect(r.apoderado_cedula).toEqual({ dedicado: "79123456", v6: "79123465" });
  });

  it("escritura: prosa notarial vs dígitos NO diverge", () => {
    const r = detectarDivergenciaLecturas(
      ded({ apoderado_escritura: "DOS MIL CUATROCIENTOS QUINCE (2415)" }), null, "2415", null,
    );
    expect(r.escritura_poder_num).toBeUndefined();
  });
  it("escritura: número distinto SÍ diverge", () => {
    const r = detectarDivergenciaLecturas(
      ded({ apoderado_escritura: "DOS MIL CUATROCIENTOS QUINCE (2415)" }), null, "2416", null,
    );
    expect(r.escritura_poder_num).toEqual({ dedicado: "2415", v6: "2416" });
  });

  it("fecha: prosa notarial vs DD-MM-AAAA NO diverge", () => {
    const r = detectarDivergenciaLecturas(
      ded({ apoderado_fecha: "DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)" }),
      null, null, "19-08-2025",
    );
    expect(r.fecha_poder).toBeUndefined();
  });
  it("fecha: día distinto SÍ diverge", () => {
    const r = detectarDivergenciaLecturas(
      ded({ apoderado_fecha: "DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)" }),
      null, null, "20-08-2025",
    );
    expect(r.fecha_poder).toEqual({ dedicado: "2025-08-19", v6: "2025-08-20" });
  });

  it("NO_LEGIBLE en V6 con valor presente en dedicado → comparación omitida", () => {
    const r = detectarDivergenciaLecturas(
      ded({ apoderado_cedula: "79.123.456", apoderado_escritura: "(2415)", apoderado_fecha: "19-08-2025" }),
      "NO_LEGIBLE", "NO_LEGIBLE", "NO_LEGIBLE",
    );
    expect(r).toEqual({});
  });

  it("formato de fecha no parseable → comparación omitida, nunca bloquea", () => {
    const r = detectarDivergenciaLecturas(
      ded({ apoderado_fecha: "agosto de 2025" }), null, null, "19-08-2025",
    );
    expect(r.fecha_poder).toBeUndefined();
  });

  it("dedicado nulo o lados ausentes → objeto vacío", () => {
    expect(detectarDivergenciaLecturas(null, "79123456", "2415", "19-08-2025")).toEqual({});
    expect(detectarDivergenciaLecturas(ded({}), "79123456", "2415", "19-08-2025")).toEqual({});
  });
});

describe("Regla 9 — integración con validatePoderBancoCoherencia", () => {
  const merged = {
    apoderado_nombre: "JUAN PEREZ",
    apoderado_cedula: "79123456",
    apoderado_escritura: "2415",
    apoderado_fecha: "19-08-2025",
    _divergencia_lecturas: {
      apoderado_cedula: { dedicado: "79123456", v6: "79123465" },
      escritura_poder_num: { dedicado: "2415", v6: "2416" },
      fecha_poder: { dedicado: "2025-08-19", v6: "2025-08-20" },
    },
  };

  it("emite los 3 warnings y son hard-block", () => {
    const r = validatePoderBancoCoherencia(merged);
    for (const w of [
      "apoderado_cedula_divergencia_lecturas",
      "escritura_poder_divergencia_lecturas",
      "fecha_poder_divergencia_lecturas",
    ]) {
      expect(r.warnings).toContain(w);
      expect(isHardBlockCoherenciaWarning(w)).toBe(true);
    }
    expect(r.suspicious.has("apoderado_cedula")).toBe(true);
    expect(r.suspicious.has("instrumento_poder.escritura_num")).toBe(true);
  });

  it("sin sidecar `_divergencia_lecturas` no emite nada de Regla 9", () => {
    const { _divergencia_lecturas: _omit, ...sinSidecar } = merged;
    const r = validatePoderBancoCoherencia(sinSidecar);
    expect(r.warnings.filter((w) => w.endsWith("_divergencia_lecturas"))).toHaveLength(0);
  });

  it("Manual > OCR: con revisión confirmada y escalares válidos se suprime", () => {
    const r = validatePoderBancoCoherencia(merged, { manualReviewConfirmed: true });
    expect(r.warnings.filter((w) => w.endsWith("_divergencia_lecturas"))).toHaveLength(0);
  });
});
