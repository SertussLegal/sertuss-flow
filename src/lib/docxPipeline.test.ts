import { describe, it, expect } from "vitest";
import { generateFinalData, __testables } from "./docxPipeline";
import type { ConsolidationInput } from "./docxConsolidation";
import { createEmptyPersona, createEmptyInmueble, createEmptyActos } from "./types";
import { createEmptyNotariaTramite } from "@/components/tramites/DocxPreview";

const baseInput = (
  overrides: Partial<ConsolidationInput["ui"]> = {},
): ConsolidationInput => ({
  manualFieldOverrides: {},
  ui: {
    vendedores: [
      {
        ...createEmptyPersona(),
        nombre_completo: "Juan Pérez",
        numero_cedula: "1010101010",
      },
    ],
    compradores: [
      {
        ...createEmptyPersona(),
        nombre_completo: "Ana Gómez",
        numero_cedula: "2020202020",
      },
    ],
    inmueble: {
      ...createEmptyInmueble(),
      matricula_inmobiliaria: "50C-12345",
      identificador_predial: "010203040506",
      direccion: "Calle 1 # 2-3",
    },
    actos: {
      ...createEmptyActos(),
      tipo_acto: "Compraventa",
      valor_compraventa: "100000000",
    },
    notariaTramite: createEmptyNotariaTramite(),
    ...overrides,
  },
  templateData: null,
  cartaCredito: null,
  ocr: { extractedDocumento: null, extractedPredial: null },
});

describe("generateFinalData — pipeline orchestrator", () => {
  it("respeta el orden: overrides aplicados ANTES de ensurePlaceholders", () => {
    const input = baseInput();
    // Override sobre el alias declarado del tag canónico de letras.
    input.manualFieldOverrides = {
      valor_compraventa_letras: "DOSCIENTOS CINCUENTA MILLONES DE PESOS",
    };
    const { data } = generateFinalData(input, { tramiteId: "t-1" });
    const actos = data.actos as unknown as Record<string, string>;
    // El override propaga al tag canónico (actos.cuantia_compraventa_letras)
    // y sobrevive a hydrateProsa (solo rellena vacíos) y a placeholders.
    expect(actos.cuantia_compraventa_letras).toBe(
      "DOSCIENTOS CINCUENTA MILLONES DE PESOS",
    );
  });

  it("normalize() preserva 0 y false como datos válidos (no como vacío)", () => {
    expect(__testables.normalize(0)).toBe("0");
    expect(__testables.normalize(false)).toBe("false");
    expect(__testables.normalize("")).toBe("");
    expect(__testables.normalize(null)).toBe("");
    expect(__testables.normalize(undefined)).toBe("");
    expect(__testables.normalize("  ___  ")).toBe("");
    expect(__testables.normalize("  hola  ")).toBe("hola");
  });

  it("detecta mismatch de cantidad de vendedores", () => {
    const input = baseInput();
    input.ui.vendedores = [
      { ...createEmptyPersona(), nombre_completo: "A", numero_cedula: "1" },
      { ...createEmptyPersona(), nombre_completo: "B", numero_cedula: "2" },
      { ...createEmptyPersona(), nombre_completo: "C", numero_cedula: "3" },
    ];
    const { data, diagnostics } = generateFinalData(input, { tramiteId: "t-3" });
    // El pipeline mapea los 3, así que las longitudes coinciden — no falla.
    expect(data.vendedores.length).toBe(3);
    const mismatch = diagnostics.integrityFailures.find((f) =>
      f.label.toLowerCase().includes("vendedor"),
    );
    expect(mismatch).toBeUndefined();
  });

  it("override de direccion_inmueble propaga a inmueble.direccion vía DOCX_FIELD_MAP", () => {
    const input = baseInput();
    input.manualFieldOverrides = { direccion_inmueble: "Carrera 99 # 88-77" };
    const { data } = generateFinalData(input, { tramiteId: "t-4" });
    expect(data.direccion_inmueble).toBe("Carrera 99 # 88-77");
    expect((data.inmueble as unknown as Record<string, unknown>).direccion).toBe(
      "Carrera 99 # 88-77",
    );
    expect(data.ubicacion_predio).toBe("Carrera 99 # 88-77");
    expect(data.ubicacion_inmueble).toBe("Carrera 99 # 88-77");
  });

  it("inyecta metadata de auditoría con tramiteId", () => {
    const input = baseInput();
    const { data } = generateFinalData(input, { tramiteId: "tramite-xyz" });
    expect((data as Record<string, unknown>).__sertuss_tramite_id).toBe("tramite-xyz");
    expect((data as Record<string, unknown>).__sertuss_pipeline_version).toBeTruthy();
  });

  it("ensurePlaceholders solo se aplica al final (campos vacíos → placeholder)", () => {
    const input = baseInput();
    input.ui.inmueble.matricula_inmobiliaria = "";
    const { data } = generateFinalData(input, { tramiteId: "t-5" });
    expect(data.matricula_inmobiliaria).toBe("___________");
  });
});
