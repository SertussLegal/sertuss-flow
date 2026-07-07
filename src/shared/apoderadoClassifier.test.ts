// ============================================================================
// Tests: classifier defensivo (Plan v7, Enmienda 1).
// Matriz cubre las 4 reglas de degradación + override manual + happy path.
// ============================================================================
import { describe, it, expect } from "vitest";
import { classifyApoderado, type ApoderadoPayload } from "@shared/apoderadoClassifier";

const baseNaturalOk: ApoderadoPayload = {
  tipo: "natural",
  nombre: "ANA MARIA MONTOYA ECHEVERRY",
  cedula: "41939243",
  escritura_poder_num: "7364",
  escritura_poder_fecha: "2023-05-26",
  escritura_poder_notaria_num: "29",
};

const baseJuridicaOk: ApoderadoPayload = {
  tipo: "juridica",
  nombre: "LINA MAGALY CAMPOS LOSADA",
  cedula: "55069433",
  sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
  sociedad_nit: "900666582-8",
  sociedad_constitucion: {
    tipo_documento: "documento_privado",
    fecha: "2013-10-18",
    camara_comercio_ciudad: "BOGOTA",
    camara_comercio_fecha: "2013-10-21",
    camara_comercio_numero: "01775236",
    libro: "IX",
  },
};

describe("classifyApoderado", () => {
  it("acepta natural limpio", () => {
    const r = classifyApoderado(baseNaturalOk);
    expect(r.tipoEfectivo).toBe("natural");
    expect(r.motivos).toEqual([]);
  });

  it("acepta jurídica limpia", () => {
    const r = classifyApoderado(baseJuridicaOk);
    expect(r.tipoEfectivo).toBe("juridica");
    expect(r.motivos).toEqual([]);
  });

  it("Regla A: degrada natural contaminada con 'S.A.S.' en cargo", () => {
    const r = classifyApoderado({
      ...baseNaturalOk,
      cargo: "Representante Legal de CONECTIVA GLOBAL S.A.S.",
    });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("corporate_keywords_in_natural_classification");
  });

  it("Regla A: degrada natural con 'Suplente del Presidente' en cargo", () => {
    const r = classifyApoderado({ ...baseNaturalOk, cargo: "Suplente del Presidente" });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("corporate_keywords_in_natural_classification");
  });

  it("Regla B: degrada jurídica sin NIT de sociedad", () => {
    const r = classifyApoderado({ ...baseJuridicaOk, sociedad_nit: "" });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("juridica_missing_constitution_data");
  });

  it("Regla B: degrada jurídica sin razón social", () => {
    const r = classifyApoderado({ ...baseJuridicaOk, sociedad_razon_social: "" });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("juridica_missing_constitution_data");
  });

  it("Regla B: degrada jurídica sin ningún dato de constitución", () => {
    const r = classifyApoderado({
      ...baseJuridicaOk,
      sociedad_constitucion: {},
    });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("juridica_missing_constitution_data");
  });

  it("Regla C: degrada natural sin escritura del poder", () => {
    const r = classifyApoderado({ ...baseNaturalOk, escritura_poder_num: "" });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("natural_missing_poder_data");
  });

  it("Regla D: baja confianza degrada a null", () => {
    const r = classifyApoderado({ ...baseNaturalOk, _confianza_tipo: "baja" });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("low_confidence_from_ocr");
  });

  it("Sin tipo → null explícito", () => {
    const r = classifyApoderado({ nombre: "PEPE" });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("no_apoderado_tipo_from_ocr");
  });

  it("Payload vacío → null con motivo", () => {
    const r = classifyApoderado(null);
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("no_apoderado_tipo_from_ocr");
  });

  it("Override manual 'juridica' gana sobre reglas de degradación", () => {
    const r = classifyApoderado({
      ...baseNaturalOk,
      cargo: "Representante Legal",
      tipo_override: "juridica",
    });
    expect(r.tipoEfectivo).toBe("juridica");
    expect(r.fromOverride).toBe(true);
    expect(r.motivos).toEqual([]);
  });

  it("Override manual 'natural' gana aunque falten datos", () => {
    const r = classifyApoderado({
      tipo: "juridica",
      tipo_override: "natural",
      // Sin escritura_poder_* pero override manda.
    });
    expect(r.tipoEfectivo).toBe("natural");
    expect(r.fromOverride).toBe(true);
  });

  it("Regla C rediseñada: patrón directo (poder general banco→natural) con instrumento_poder es válido sin escritura_poder_*", () => {

    const r = classifyApoderado(
      {
        tipo: "natural",
        nombre: "ANA MARIA MONTOYA ECHEVERRY",
        cedula: "52857443",
        // Sin escritura_poder_num/fecha/notaria (no hay sustitución).
      },
      {
        instrumento_poder: {
          escritura_num: "7364",
          fecha: "2023-05-26",
          notaria_numero: "29",
          notaria_ciudad: "BOGOTA D.C.",
        },
        has_apoderado_banco_v3: "true",
      },
    );
    expect(r.tipoEfectivo).toBe("natural");
    expect(r.motivos).toEqual([]);
  });

  it("Regla C rediseñada: sin ctx, mantiene retrocompatibilidad exigiendo escritura_poder_*", () => {
    const r = classifyApoderado(baseNaturalOk);
    expect(r.tipoEfectivo).toBe("natural");
  });

  it("Regla C rediseñada: natural por sustitución (escritura_poder_*) sin ctx sigue válido", () => {
    const r = classifyApoderado({
      tipo: "natural",
      nombre: "PEDRO PEREZ",
      cedula: "12345",
      escritura_poder_num: "111",
      escritura_poder_fecha: "2020-01-01",
      escritura_poder_notaria_num: "5",
    });
    expect(r.tipoEfectivo).toBe("natural");
  });

  it("Regla C rediseñada: sin evidencia (ni ctx ni escritura) degrada", () => {
    const r = classifyApoderado({
      tipo: "natural",
      nombre: "PEDRO PEREZ",
      cedula: "12345",
    });
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("natural_missing_poder_data");
  });

  it("Regla C rediseñada: sin identidad (falta cédula) degrada aunque haya ctx", () => {
    const r = classifyApoderado(
      { tipo: "natural", nombre: "ANA" },
      {
        instrumento_poder: { escritura_num: "1", fecha: "2020-01-01", notaria_numero: "1" },
      },
    );
    expect(r.tipoEfectivo).toBeNull();
    expect(r.motivos).toContain("natural_missing_poder_data");
  });
});

