// Regla 8 — Múltiples apoderados naturales candidatos en un mismo Poder.
// El Poder puede nombrar a varias personas naturales en el bloque vigente;
// el sistema no puede saber cuál actuó, así que exige confirmación humana.
import { describe, it, expect } from "vitest";
import {
  validatePoderBancoCoherencia,
  isHardBlockCoherenciaWarning,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";
import {
  MANUAL_OVERRIDE_RULES,
  applyManualOverrideExceptions,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/hardBlockRules";

const CODE = "apoderado_natural_candidatos_requiere_confirmacion";

const CAND_A = { nombre: "FELIX ROZO CAGUA", cedula: "79392406" };
const CAND_B = { nombre: "LINA MAGALY CAMPOS LOSADA", cedula: "52111222" };

const merged = (
  candidatos: Array<Record<string, unknown>>,
  candidato_confirmado_cedula?: string,
  tipo = "natural",
) => ({
  apoderado_cedula: CAND_A.cedula,
  apoderado: {
    tipo,
    nombre: CAND_A.nombre,
    cedula: CAND_A.cedula,
    candidatos_natural: candidatos,
    ...(candidato_confirmado_cedula !== undefined ? { candidato_confirmado_cedula } : {}),
  },
});

describe("Regla 8 — apoderado_natural_candidatos_requiere_confirmacion", () => {
  it("1. 1 solo candidato en candidatos_natural → Regla 8 NO dispara", () => {
    const { warnings } = validatePoderBancoCoherencia(merged([CAND_A]));
    expect(warnings).not.toContain(CODE);
  });

  it("2. 2 candidatos, sin confirmar → Regla 8 SÍ dispara y es hard-block", () => {
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged([CAND_A, CAND_B]));
    expect(warnings).toContain(CODE);
    expect(suspicious.has("apoderado.candidatos_natural")).toBe(true);
    expect(isHardBlockCoherenciaWarning(CODE)).toBe(true);
  });

  it("3. 2 candidatos, confirmado correctamente + manualReviewConfirmed=true → se suprime", () => {
    const { warnings } = validatePoderBancoCoherencia(
      merged([CAND_A, CAND_B], CAND_B.cedula),
      { manualReviewConfirmed: true },
    );
    expect(warnings).not.toContain(CODE);
  });

  it("4. 2 candidatos, cédula confirmada coincide PERO manualReviewConfirmed=false → sigue bloqueado", () => {
    const { warnings } = validatePoderBancoCoherencia(
      merged([CAND_A, CAND_B], CAND_B.cedula),
      { manualReviewConfirmed: false },
    );
    expect(warnings).toContain(CODE);
  });

  it("5. cédula confirmada YA NO está en la lista actual + manualReviewConfirmed=true → sigue bloqueado", () => {
    // Caso crítico: el documento se reprocesó y la lista de candidatos cambió.
    // Una confirmación vieja (de una lista distinta) NO debe suprimir el
    // warning silenciosamente — la regla exige que la cédula confirmada siga
    // presente en `candidatos_natural` actual, de modo que el bloqueo se
    // re-activa solo y obliga a re-confirmar contra la lista nueva.
    const { warnings } = validatePoderBancoCoherencia(
      merged([CAND_A, CAND_B], "80333444"),
      { manualReviewConfirmed: true },
    );
    expect(warnings).toContain(CODE);
  });

  it("6. tipo='juridica' con candidatos_natural poblado → Regla 8 NO aplica", () => {
    const { warnings } = validatePoderBancoCoherencia(
      merged([CAND_A, CAND_B], undefined, "juridica"),
    );
    expect(warnings).not.toContain(CODE);
  });

  it("7. applyManualOverrideExceptions suprime solo cuando la cédula confirmada coincide", () => {
    const rule = MANUAL_OVERRIDE_RULES.find((r) => r.warning === CODE);
    expect(rule).toBeDefined();

    const dataCoincide = {
      poder_banco: {
        apoderado: {
          tipo: "natural",
          candidatos_natural: [CAND_A, CAND_B],
          candidato_confirmado_cedula: CAND_B.cedula,
        },
      },
    };
    const dataNoCoincide = {
      poder_banco: {
        apoderado: {
          tipo: "natural",
          candidatos_natural: [CAND_A, CAND_B],
          candidato_confirmado_cedula: "80333444",
        },
      },
    };

    expect(rule!.canSuppress(dataCoincide)).toBe(true);
    expect(rule!.canSuppress(dataNoCoincide)).toBe(false);
    expect(applyManualOverrideExceptions([CODE], dataCoincide)).toEqual([]);
    expect(applyManualOverrideExceptions([CODE], dataNoCoincide)).toEqual([CODE]);
  });
});
