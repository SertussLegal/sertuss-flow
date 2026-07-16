// Regla 5 (Fase 1) — Coherencia intra-documento del RL del banco.
// Cubre el caso real 79392406 vs 79382406 y variantes.
import { describe, it, expect } from "vitest";
import {
  validatePoderBancoCoherencia,
  HARD_BLOCK_WARNING_SUFFIXES,
  isHardBlockCoherenciaWarning,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

const baseMerged = (menciones_rl?: unknown) => ({
  poderdante: {
    representante_legal_nombre: "FELIX ROZO CAGUA",
    representante_legal_cedula: "79392406",
    ...(menciones_rl !== undefined ? { menciones_rl } : {}),
  },
});

describe("Regla 5 — rl_banco_menciones_incoherentes", () => {
  it("1. Caso real: 79392406 (cuerpo) vs 79382406 (superfinanciera) → dispara warning + suspicious + hard-block", () => {
    const merged = baseMerged([
      { seccion: "cuerpo_poder", nombre: "FELIX ROZO CAGUA", cedula: "79392406", pagina: 1 },
      { seccion: "certificado_superfinanciera", nombre: "FELIX ROZO CAGUA", cedula: "79382406", pagina: 12 },
    ]);
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("rl_banco_menciones_incoherentes");
    expect(suspicious.has("poderdante.menciones_rl")).toBe(true);
    expect(suspicious.has("poderdante.representante_legal_cedula")).toBe(true);
    expect(isHardBlockCoherenciaWarning("rl_banco_menciones_incoherentes")).toBe(true);
  });

  it("2. Menciones consistentes (3 iguales) → no dispara", () => {
    const merged = baseMerged([
      { seccion: "cuerpo_poder", cedula: "79382406" },
      { seccion: "firma", cedula: "79382406" },
      { seccion: "certificado_superfinanciera", cedula: "79382406" },
    ]);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("rl_banco_menciones_incoherentes");
  });

  it("3. 1 sola mención → no dispara", () => {
    const merged = baseMerged([{ seccion: "cuerpo_poder", cedula: "79382406" }]);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("rl_banco_menciones_incoherentes");
  });

  it("4. Sin menciones_rl (payload legacy / caché viejo) → no dispara", () => {
    const merged = baseMerged(undefined);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("rl_banco_menciones_incoherentes");
  });

  it("5. Normalización de formato (puntos/espacios) → no dispara", () => {
    const merged = baseMerged([
      { seccion: "cuerpo_poder", cedula: "79.382.406" },
      { seccion: "firma", cedula: "79382406" },
      { seccion: "certificado_superfinanciera", cedula: "79 382 406" },
    ]);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("rl_banco_menciones_incoherentes");
  });

  it("6. NO_LEGIBLE parcial + resto consistente → no dispara Regla 5", () => {
    const merged = baseMerged([
      { seccion: "cuerpo_poder", cedula: "NO_LEGIBLE" },
      { seccion: "firma", cedula: "79382406" },
      { seccion: "certificado_superfinanciera", cedula: "79382406" },
    ]);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("rl_banco_menciones_incoherentes");
  });

  it("7. Contrato HARD_BLOCK — incluye _menciones_incoherentes y isHardBlock lo reconoce", () => {
    expect(HARD_BLOCK_WARNING_SUFFIXES).toContain("_menciones_incoherentes");
    expect(isHardBlockCoherenciaWarning("rl_banco_menciones_incoherentes")).toBe(true);
    expect(isHardBlockCoherenciaWarning("apoderado_cedula_no_legible")).toBe(true);
    expect(isHardBlockCoherenciaWarning("algun_warning_random")).toBe(false);
  });

  it("8. Excepción Manual>OCR: humano confirmó + cédula RL escalar válida → warning suprimido, menciones_rl intactas", () => {
    // Menciones incoherentes (dispararían Regla 5 en flujo normal).
    const merged = baseMerged([
      { seccion: "cuerpo_poder", cedula: "79392406" },
      { seccion: "certificado_superfinanciera", cedula: "79382406" },
    ]);
    // Con confirmación humana Y cédula escalar de formato válido → suprimir.
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged, {
      manualReviewConfirmed: true,
    });
    expect(warnings).not.toContain("rl_banco_menciones_incoherentes");
    expect(suspicious.has("poderdante.menciones_rl")).toBe(false);
    // El input de `menciones_rl` NO se muta: sigue siendo evidencia forense.
    expect((merged.poderdante as any).menciones_rl).toHaveLength(2);
    expect((merged.poderdante as any).menciones_rl[1].cedula).toBe("79382406");
  });

  it("9. Sin confirmación humana → warning sigue activo (no se suprime prematuramente)", () => {
    const merged = baseMerged([
      { seccion: "cuerpo_poder", cedula: "79392406" },
      { seccion: "certificado_superfinanciera", cedula: "79382406" },
    ]);
    const { warnings } = validatePoderBancoCoherencia(merged, {
      manualReviewConfirmed: false,
    });
    expect(warnings).toContain("rl_banco_menciones_incoherentes");
  });

  it("10. Confirmación humana + cédula escalar inválida (letras) → NO se suprime", () => {
    const merged = {
      poderdante: {
        representante_legal_nombre: "FELIX",
        representante_legal_cedula: "ABC-123", // formato inválido
        menciones_rl: [
          { seccion: "cuerpo_poder", cedula: "79392406" },
          { seccion: "certificado_superfinanciera", cedula: "79382406" },
        ],
      },
    };
    const { warnings } = validatePoderBancoCoherencia(merged, {
      manualReviewConfirmed: true,
    });
    expect(warnings).toContain("rl_banco_menciones_incoherentes");
  });
});
