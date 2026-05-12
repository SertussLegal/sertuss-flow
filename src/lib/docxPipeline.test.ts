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

describe("generateFinalData — pipeline orchestrator v3.2", () => {
  it("materializa claves literales con punto en la raíz (inmueble.matricula, actos.entidad_bancaria)", () => {
    const input = baseInput();
    input.ui.actos.es_hipoteca = true;
    input.ui.actos.entidad_bancaria = "BANCO CAJA SOCIAL S.A.";
    const { data } = generateFinalData(input, { tramiteId: "t-mat" });
    const root = data as unknown as Record<string, unknown>;

    // Tags exactos que pide la plantilla Word:
    expect(root["inmueble.matricula"]).toBe("50C-12345");
    expect(root["inmueble.cedula_catastral"]).toBe("010203040506");
    expect(root["inmueble.direccion"]).toBe("Calle 1 # 2-3");
    expect(root["actos.entidad_bancaria"]).toBe("BANCO CAJA SOCIAL S.A.");
    // El objeto anidado sigue presente:
    expect((root.inmueble as Record<string, unknown>).matricula).toBe("50C-12345");
  });

  it("respeta el orden: overrides aplicados ANTES de hidratar prosa", () => {
    const input = baseInput();
    input.manualFieldOverrides = {
      valor_compraventa_letras: "DOSCIENTOS CINCUENTA MILLONES DE PESOS",
    };
    const { data } = generateFinalData(input, { tramiteId: "t-1" });
    const actos = data.actos as unknown as Record<string, string>;
    expect(actos.cuantia_compraventa_letras).toBe(
      "DOSCIENTOS CINCUENTA MILLONES DE PESOS",
    );
  });

  it("override sobre clave dotted pisa anidado + clave literal materializada", () => {
    const input = baseInput();
    input.manualFieldOverrides = { "inmueble.matricula": "9999-OVR" };
    const { data } = generateFinalData(input, { tramiteId: "t-ovr" });
    const root = data as unknown as Record<string, unknown>;
    expect(root["inmueble.matricula"]).toBe("9999-OVR");
    expect((root.inmueble as Record<string, unknown>).matricula).toBe("9999-OVR");
    // También propaga al canónico raíz vía DOCX_FIELD_MAP.
    expect(root.matricula_inmobiliaria).toBe("9999-OVR");
    expect(root.matricula).toBe("9999-OVR");
  });

  it("normalize() preserva 0 y false como datos válidos", () => {
    expect(__testables.normalize(0)).toBe("0");
    expect(__testables.normalize(false)).toBe("false");
    expect(__testables.normalize("")).toBe("");
    expect(__testables.normalize(null)).toBe("");
    expect(__testables.normalize("  ___  ")).toBe("");
    expect(__testables.normalize("  hola  ")).toBe("hola");
  });

  it("integrityCheck dispara error si la UI tiene matrícula pero la materialización falló", () => {
    // Simulamos el caso real: data UI con matrícula, pipeline data SIN ella.
    const fakeData = {
      vendedores: [],
      compradores: [],
      actos: {},
    } as unknown as Parameters<typeof __testables.runIntegrityCheck>[1];
    const ui = {
      vendedores: [],
      compradores: [],
      inmueble: { matricula_inmobiliaria: "50C-1", identificador_predial: "", direccion: "" },
      actos: { valor_compraventa: "", es_hipoteca: false },
      notariaTramite: {} as never,
    } as unknown as Parameters<typeof __testables.runIntegrityCheck>[0];
    const failures = __testables.runIntegrityCheck(ui, fakeData);
    expect(failures.find((f) => f.label === "Matrícula")).toBeTruthy();
  });

  it("integrityCheck pasa cuando la matrícula vive solo en la clave literal materializada", () => {
    const fakeData = {
      "inmueble.matricula": "50C-1",
      vendedores: [],
      compradores: [],
      actos: {},
    } as unknown as Parameters<typeof __testables.runIntegrityCheck>[1];
    const ui = {
      vendedores: [],
      compradores: [],
      inmueble: { matricula_inmobiliaria: "50C-1", identificador_predial: "", direccion: "" },
      actos: { valor_compraventa: "", es_hipoteca: false },
      notariaTramite: {} as never,
    } as unknown as Parameters<typeof __testables.runIntegrityCheck>[0];
    const failures = __testables.runIntegrityCheck(ui, fakeData);
    expect(failures.find((f) => f.label === "Matrícula")).toBeFalsy();
  });

  it("override de direccion_inmueble propaga a anidado, alias y clave literal", () => {
    const input = baseInput();
    input.manualFieldOverrides = { direccion_inmueble: "Carrera 99 # 88-77" };
    const { data } = generateFinalData(input, { tramiteId: "t-4" });
    const root = data as unknown as Record<string, unknown>;
    expect(root.direccion_inmueble).toBe("Carrera 99 # 88-77");
    expect(root.ubicacion_predio).toBe("Carrera 99 # 88-77");
    expect((root.inmueble as Record<string, unknown>).direccion).toBe("Carrera 99 # 88-77");
    expect(root["inmueble.direccion"]).toBe("Carrera 99 # 88-77");
  });

  it("inyecta metadata de auditoría con tramiteId", () => {
    const input = baseInput();
    const { data } = generateFinalData(input, { tramiteId: "tramite-xyz" });
    expect((data as Record<string, unknown>).__sertuss_tramite_id).toBe("tramite-xyz");
    expect((data as Record<string, unknown>).__sertuss_pipeline_version).toBe(
      "v3.2.materialize",
    );
  });

  it("ensurePlaceholders solo se aplica al final (campos vacíos → placeholder)", () => {
    const input = baseInput();
    input.ui.inmueble.matricula_inmobiliaria = "";
    const { data } = generateFinalData(input, { tramiteId: "t-5" });
    expect(data.matricula_inmobiliaria).toBe("___________");
    // La materialización tampoco debe inventar valor.
    expect((data as unknown as Record<string, unknown>)["inmueble.matricula"]).toBe(
      "___________",
    );
  });
});
