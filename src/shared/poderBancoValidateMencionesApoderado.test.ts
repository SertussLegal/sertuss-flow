// Regla 6 — Coherencia intra-documento de la cédula del apoderado.
// Espejo de Regla 5, con desambiguación por NOMBRE para tolerar múltiples
// firmantes legítimos (RL + suplente en poderes tipo='juridica').
import { describe, it, expect } from "vitest";
import {
  validatePoderBancoCoherencia,
  isHardBlockCoherenciaWarning,
  normalizeNombreFirmante,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

const naturalMerged = (menciones_cedula?: unknown, cedulaEscalar = "79392406") => ({
  apoderado_cedula: cedulaEscalar,
  apoderado: {
    tipo: "natural",
    nombre: "FELIX ROZO CAGUA",
    cedula: cedulaEscalar,
    ...(menciones_cedula !== undefined ? { menciones_cedula } : {}),
  },
});

const juridicaMerged = (menciones_cedula: unknown, representantes: Array<Record<string, unknown>>) => ({
  apoderado: {
    tipo: "juridica",
    sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
    representantes,
    menciones_cedula,
  },
});

describe("Regla 6 — apoderado_cedula_menciones_incoherentes", () => {
  it("1. 3 menciones consistentes (1 apoderado natural) → no dispara", () => {
    const merged = naturalMerged([
      { seccion: "cuerpo_poder", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
      { seccion: "firma", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
      { seccion: "identificacion_al_pie", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
    ]);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("apoderado_cedula_menciones_incoherentes");
  });

  it("2. Caso ancla — 2 menciones del mismo apoderado con transposición → dispara + hard-block + suspicious", () => {
    const merged = naturalMerged([
      { seccion: "cuerpo_poder", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
      { seccion: "firma", nombre: "FELIX ROZO CAGUA", cedula: "79382406" },
    ]);
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("apoderado_cedula_menciones_incoherentes");
    expect(suspicious.has("apoderado.menciones_cedula")).toBe(true);
    expect(suspicious.has("apoderado.cedula")).toBe(true);
    expect(suspicious.has("apoderado_cedula")).toBe(true);
    expect(isHardBlockCoherenciaWarning("apoderado_cedula_menciones_incoherentes")).toBe(true);
  });

  it("3. 1 sola mención → no dispara", () => {
    const merged = naturalMerged([
      { seccion: "cuerpo_poder", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
    ]);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("apoderado_cedula_menciones_incoherentes");
  });

  it("4. NO_LEGIBLE parcial + resto consistente → no dispara", () => {
    const merged = naturalMerged([
      { seccion: "cuerpo_poder", nombre: "FELIX ROZO CAGUA", cedula: "NO_LEGIBLE" },
      { seccion: "firma", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
      { seccion: "identificacion_al_pie", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
    ]);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("apoderado_cedula_menciones_incoherentes");
  });

  it("5. 2 apoderados (Lina + Kleitman suplente) con cédulas distintas pero cada grupo interno consistente → NO dispara (agrupamiento por nombre)", () => {
    const merged = juridicaMerged(
      [
        { seccion: "cuerpo_poder", nombre: "LINA MAGALY CAMPOS LOSADA", cedula: "52111222" },
        { seccion: "firma", nombre: "LINA MAGALY CAMPOS LOSADA", cedula: "52111222" },
        { seccion: "cuerpo_poder", nombre: "KLEITMAN RAFAEL MUÑOZ AVILA", cedula: "80333444" },
        { seccion: "firma", nombre: "KLEITMAN RAFAEL MUÑOZ AVILA, PRIMER SUPLENTE", cedula: "80333444" },
      ],
      [
        { nombre: "LINA MAGALY CAMPOS LOSADA", cedula: "52111222", cargo: "REPRESENTANTE LEGAL", es_firmante: true },
        { nombre: "KLEITMAN RAFAEL MUÑOZ AVILA", cedula: "80333444", cargo: "PRIMER SUPLENTE", es_firmante: true },
      ],
    );
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("apoderado_cedula_menciones_incoherentes");
  });

  it("6. 2 apoderados, transposición DENTRO del grupo Kleitman → dispara; grupo Lina intacto", () => {
    const merged = juridicaMerged(
      [
        { seccion: "cuerpo_poder", nombre: "LINA MAGALY CAMPOS LOSADA", cedula: "52111222" },
        { seccion: "firma", nombre: "LINA MAGALY CAMPOS LOSADA", cedula: "52111222" },
        { seccion: "cuerpo_poder", nombre: "KLEITMAN RAFAEL MUÑOZ AVILA", cedula: "80333444" },
        { seccion: "firma", nombre: "KLEITMAN RAFAEL MUÑOZ AVILA", cedula: "80343444" },
      ],
      [
        { nombre: "LINA MAGALY CAMPOS LOSADA", cedula: "52111222", es_firmante: true },
        { nombre: "KLEITMAN RAFAEL MUÑOZ AVILA", cedula: "80333444", es_firmante: true },
      ],
    );
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
    expect(warnings).toContain("apoderado_cedula_menciones_incoherentes");
    expect(suspicious.has("apoderado.menciones_cedula")).toBe(true);
  });

  it("7. Formato distinto (puntos/espacios) sin cambio de dígitos → no dispara", () => {
    const merged = naturalMerged([
      { seccion: "cuerpo_poder", nombre: "FELIX ROZO CAGUA", cedula: "79.392.406" },
      { seccion: "firma", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
      { seccion: "identificacion_al_pie", nombre: "FELIX ROZO CAGUA", cedula: "79 392 406" },
    ]);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("apoderado_cedula_menciones_incoherentes");
  });

  it("8. Payload legacy sin menciones_cedula → no dispara", () => {
    const merged = naturalMerged(undefined);
    const { warnings } = validatePoderBancoCoherencia(merged);
    expect(warnings).not.toContain("apoderado_cedula_menciones_incoherentes");
  });

  it("9. Excepción Manual>OCR: humano confirmó + escalar válido → warning suprimido, menciones intactas", () => {
    const merged = naturalMerged(
      [
        { seccion: "cuerpo_poder", nombre: "FELIX ROZO CAGUA", cedula: "79392406" },
        { seccion: "firma", nombre: "FELIX ROZO CAGUA", cedula: "79382406" },
      ],
      "79392406",
    );
    const { warnings, suspicious } = validatePoderBancoCoherencia(merged, {
      manualReviewConfirmed: true,
    });
    expect(warnings).not.toContain("apoderado_cedula_menciones_incoherentes");
    expect(suspicious.has("apoderado.menciones_cedula")).toBe(false);
    expect((merged.apoderado as any).menciones_cedula).toHaveLength(2);
    expect((merged.apoderado as any).menciones_cedula[1].cedula).toBe("79382406");
  });

  it("10. Contrato hard-block reconoce el sufijo _menciones_incoherentes", () => {
    expect(isHardBlockCoherenciaWarning("apoderado_cedula_menciones_incoherentes")).toBe(true);
  });

  it("11. normalizeNombreFirmante — coletillas de cargo colapsan a la misma clave", () => {
    expect(normalizeNombreFirmante("KLEITMAN RAFAEL MUÑOZ AVILA"))
      .toBe(normalizeNombreFirmante("Kleitman Rafael Muñoz Avila, PRIMER SUPLENTE"));
    expect(normalizeNombreFirmante("LINA MAGALY CAMPOS LOSADA (REPRESENTANTE LEGAL)"))
      .toBe(normalizeNombreFirmante("Lina Magaly Campos Losada"));
    expect(normalizeNombreFirmante("")).toBe("");
    expect(normalizeNombreFirmante("NO_LEGIBLE")).toBe("");
  });
});
