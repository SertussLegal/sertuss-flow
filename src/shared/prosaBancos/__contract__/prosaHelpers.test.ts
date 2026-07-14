// ============================================================================
// prosaHelpers.test — Cobertura de helpers defensivos compartidos.
// Bugs cubiertos:
//   A) `numero` no debe imprimirse cuando tipo_documento='documento_privado'
//      aunque el OCR haya rellenado el campo por error.
//   B) Reforma societaria degradada: menciona lo que tenga, no calla todo.
//   C) Cargo del RL ausente / genérico: NO duplicar "representante legal".
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  describirConstitucionSociedad,
  describirCargoRL,
} from "@shared/prosaBancos/prosaHelpers";

describe("describirConstitucionSociedad — Bug A: documento_privado ignora numero", () => {
  it("omite `numero` cuando tipo_documento='documento_privado' aunque el OCR lo rellene", () => {
    const out = describirConstitucionSociedad({
      sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
      sociedad_constitucion: {
        tipo_documento: "documento_privado",
        // Basura del OCR: el modelo copió el número de inscripción de Cámara.
        numero: "01775236",
        fecha_texto: "18 de octubre de 2013",
        camara_comercio_ciudad: "BOGOTA",
        camara_comercio_numero: "01775236",
        libro: "IX",
      },
    });
    expect(out).toContain("documento privado");
    expect(out).toContain("18 de octubre de 2013");
    // El "01775236" solo puede aparecer una vez, y siempre como número de Cámara.
    const matches = out.match(/01775236/g) ?? [];
    expect(matches.length).toBe(1);
    expect(out).toContain("bajo el número 01775236");
    // No debe haber prefijo "número <letras> (01775236) documento privado".
    expect(out).not.toMatch(/documento privado n[uú]mero/i);
  });

  it("SÍ imprime `numero` cuando tipo_documento='escritura_publica'", () => {
    const out = describirConstitucionSociedad({
      sociedad_razon_social: "SOCIEDAD X S.A.",
      sociedad_constitucion: {
        tipo_documento: "escritura_publica",
        numero: "1234",
        fecha_texto: "cinco de mayo de dos mil diez",
      },
    });
    expect(out).toMatch(/escritura p[uú]blica n[uú]mero/i);
    expect(out).toContain("(1234)");
  });
});

describe("describirConstitucionSociedad — Bug B: reforma con degradación", () => {
  it("razon_social_anterior + 3 campos completos → frase canónica", () => {
    const out = describirConstitucionSociedad({
      sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
      sociedad_constitucion: {
        tipo_documento: "documento_privado",
        fecha_texto: "18 de octubre de 2013",
        razon_social_anterior: "PROYECTOS LEGALES S.A.S.",
        reforma_acta_numero: "5",
        reforma_acta_fecha_texto: "12 de enero de 2023",
        reforma_camara_fecha_texto: "20 de enero de 2023",
      },
    });
    expect(out).toContain("PROYECTOS LEGALES S.A.S.");
    expect(out).toContain("CONECTIVA GLOBAL S.A.S.");
    expect(out).toContain("12 de enero de 2023");
    expect(out).toContain("20 de enero de 2023");
  });

  it("solo razon_social_anterior (0 de 3 subcampos) → menciona cambio sin fechas", () => {
    const out = describirConstitucionSociedad({
      sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
      sociedad_constitucion: {
        tipo_documento: "documento_privado",
        fecha_texto: "18 de octubre de 2013",
        razon_social_anterior: "PROYECTOS LEGALES S.A.S.",
        reforma_acta_numero: null,
        reforma_acta_fecha_texto: null,
        reforma_camara_fecha_texto: null,
      },
    });
    expect(out).toContain("PROYECTOS LEGALES S.A.S.");
    expect(out).toContain("CONECTIVA GLOBAL S.A.S.");
    expect(out).toMatch(/cambi[oó] su raz[oó]n social/i);
    // No debe fabricar la palabra "acta" cuando no hay ninguno de los subcampos.
    expect(out).not.toMatch(/mediante acta,/i);
  });

  it("razon_social_anterior + 1 de 3 subcampos → menciona lo que hay", () => {
    const out = describirConstitucionSociedad({
      sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
      sociedad_constitucion: {
        tipo_documento: "documento_privado",
        fecha_texto: "18 de octubre de 2013",
        razon_social_anterior: "PROYECTOS LEGALES S.A.S.",
        reforma_acta_fecha_texto: "12 de enero de 2023",
      },
    });
    expect(out).toContain("PROYECTOS LEGALES S.A.S.");
    expect(out).toContain("12 de enero de 2023");
    expect(out).toContain("CONECTIVA GLOBAL S.A.S.");
  });

  it("sin razon_social_anterior → omite todo el bloque de reforma", () => {
    const out = describirConstitucionSociedad({
      sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
      sociedad_constitucion: {
        tipo_documento: "documento_privado",
        fecha_texto: "18 de octubre de 2013",
      },
    });
    expect(out).not.toMatch(/inicialmente como/i);
    expect(out).not.toMatch(/cambi[oó] su raz[oó]n social/i);
  });
});

describe("describirCargoRL — Bug C: no duplicar 'representante legal'", () => {
  it("cargo específico → frase canónica con doble mención justificada", () => {
    const out = describirCargoRL("SUPLENTE DEL PRESIDENTE", "BANCO DAVIVIENDA S.A.");
    expect(out).toBe(
      "obrando en su condición de suplente del presidente y como tal representante legal del BANCO DAVIVIENDA S.A.",
    );
  });

  it("cargo null → frase sin doble mención", () => {
    const out = describirCargoRL(null, "BANCO DAVIVIENDA S.A.");
    expect(out).toBe(
      "obrando en su condición de representante legal del BANCO DAVIVIENDA S.A.",
    );
  });

  it("cargo string vacío → frase sin doble mención", () => {
    const out = describirCargoRL("   ", "BANCO DAVIVIENDA S.A.");
    expect(out).toBe(
      "obrando en su condición de representante legal del BANCO DAVIVIENDA S.A.",
    );
  });

  it("cargo genérico 'REPRESENTANTE LEGAL' (cualquier casing) → sin duplicar", () => {
    const out1 = describirCargoRL("REPRESENTANTE LEGAL", "BANCO X");
    const out2 = describirCargoRL("representante legal", "BANCO X");
    expect(out1).toBe("obrando en su condición de representante legal del BANCO X");
    expect(out2).toBe(out1);
  });
});
