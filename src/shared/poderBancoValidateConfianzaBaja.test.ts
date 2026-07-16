// Regla 7 — Confianza baja reportada por Gemini en 4 campos críticos.
// Sidecar `_confianza` emitido por mergePoderBancoV6; advertencia ámbar,
// nunca hard-block. Excepción Manual>OCR idéntica a Reglas 5/6.
import { describe, it, expect } from "vitest";
import {
  validatePoderBancoCoherencia,
  isHardBlockCoherenciaWarning,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

const base = (over: Record<string, unknown> = {}) => ({
  apoderado_cedula: "52123456",
  apoderado: { tipo: "natural", nombre: "ANA MARIA", cedula: "52123456" },
  poderdante: { representante_legal_cedula: "79800800" },
  instrumento_poder: { escritura_num: "2415", fecha: "2025-08-19" },
  ...over,
});

describe("Regla 7 — confianza baja", () => {
  it("1. apoderado.cedula con confianza=baja → dispara warning + suspicious", () => {
    const merged = base({ _confianza: { "apoderado.cedula": "baja" } });
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("apoderado_cedula_confianza_baja");
    expect(suspicious.has("apoderado.cedula")).toBe(true);
  });

  it("2. poderdante.representante_legal_cedula confianza=baja → dispara", () => {
    const merged = base({
      _confianza: { "poderdante.representante_legal_cedula": "baja" },
    });
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("poderdante_rl_cedula_confianza_baja");
    expect(suspicious.has("poderdante.representante_legal_cedula")).toBe(true);
  });

  it("3. instrumento_poder.escritura_num confianza=baja → dispara", () => {
    const merged = base({
      _confianza: { "instrumento_poder.escritura_num": "baja" },
    });
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("escritura_poder_confianza_baja");
    expect(suspicious.has("instrumento_poder.escritura_num")).toBe(true);
  });

  it("4. instrumento_poder.fecha confianza=baja → dispara", () => {
    const merged = base({ _confianza: { "instrumento_poder.fecha": "baja" } });
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("fecha_poder_confianza_baja");
    expect(suspicious.has("instrumento_poder.fecha")).toBe(true);
  });

  it("5. confianza=media|alta → no dispara ninguno", () => {
    const merged = base({
      _confianza: {
        "apoderado.cedula": "media",
        "poderdante.representante_legal_cedula": "alta",
        "instrumento_poder.escritura_num": "alta",
        "instrumento_poder.fecha": "media",
      },
    });
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings.some((w) => w.endsWith("_confianza_baja"))).toBe(false);
  });

  it("6. sidecar ausente (registro histórico) → no dispara", () => {
    const merged = base();
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings.some((w) => w.endsWith("_confianza_baja"))).toBe(false);
  });

  it("7. Excepción Manual>OCR: humano confirmó + escalar formato válido → suprime", () => {
    const merged = base({
      _confianza: {
        "apoderado.cedula": "baja",
        "poderdante.representante_legal_cedula": "baja",
        "instrumento_poder.escritura_num": "baja",
        "instrumento_poder.fecha": "baja",
      },
    });
    const { warnings } = validatePoderBancoCoherencia(merged, {
      manualReviewConfirmed: true,
    });
    expect(warnings.some((w) => w.endsWith("_confianza_baja"))).toBe(false);
    // El sidecar se preserva íntegro como evidencia forense (validate no lo toca).
    expect((merged as Record<string, unknown>)._confianza).toBeTruthy();
  });

  it("8. Escalar vacío + confianza baja → no dispara (Gemini no leyó nada)", () => {
    const merged = {
      apoderado_cedula: "",
      apoderado: { tipo: "natural", nombre: "ANA", cedula: "" },
      _confianza: { "apoderado.cedula": "baja" },
    };
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("apoderado_cedula_confianza_baja");
  });

  it("9. Escalar = NO_LEGIBLE → Regla 3 lo cubre, Regla 7 no duplica", () => {
    const merged = base({
      apoderado_cedula: "NO_LEGIBLE",
      apoderado: { tipo: "natural", nombre: "ANA", cedula: "NO_LEGIBLE" },
      _confianza: { "apoderado.cedula": "baja" },
    });
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("apoderado_cedula_confianza_baja");
    expect(warnings).toContain("apoderado_cedula_no_legible");
  });

  it("10. Contrato hard-block: los 4 warnings NO son hard-block", () => {
    expect(isHardBlockCoherenciaWarning("apoderado_cedula_confianza_baja")).toBe(false);
    expect(isHardBlockCoherenciaWarning("poderdante_rl_cedula_confianza_baja")).toBe(false);
    expect(isHardBlockCoherenciaWarning("escritura_poder_confianza_baja")).toBe(false);
    expect(isHardBlockCoherenciaWarning("fecha_poder_confianza_baja")).toBe(false);
  });

  it("11. Excepción Manual>OCR con escalar inválido → NO suprime", () => {
    const merged = base({
      apoderado_cedula: "abc", // formato inválido
      apoderado: { tipo: "natural", nombre: "ANA", cedula: "abc" },
      _confianza: { "apoderado.cedula": "baja" },
    });
    const { warnings } = validatePoderBancoCoherencia(merged, {
      manualReviewConfirmed: true,
    });
    expect(warnings).toContain("apoderado_cedula_confianza_baja");
  });
});
