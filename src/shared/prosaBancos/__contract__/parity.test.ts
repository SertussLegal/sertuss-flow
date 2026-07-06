// ============================================================================
// parity.test.ts — Test de PARIDAD BYTE-A-BYTE con snapshots congelados.
// Cualquier cambio en la prosa canónica falla aquí y obliga a revisión legal.
// ============================================================================

import { describe, it, expect } from "vitest";
import { daviviendaTemplate } from "../davivienda";
import { mergeOverride } from "../mergeOverride";
import type { ProsaContext, ProsaApoderadoOverride } from "../types";

const ctxNatural: ProsaContext = {
  apoderado: {
    tipo: "natural",
    nombre: "ANA MARIA MONTOYA ECHEVERRY",
    cedula: "41939243",
    escritura_poder_num: "7364",
    escritura_poder_fecha: "2023-05-26",
    escritura_poder_notaria_num: "29",
  },
  poderdante: {},
  instrumento: {},
  ciudad_firma: "Bogotá",
};

const ctxJuridica: ProsaContext = {
  apoderado: {
    tipo: "juridica",
    nombre: "LINA MAGALY CAMPOS LOSADA",
    cedula: "55069433",
    sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
    sociedad_nit: "900.666.582-8",
    sociedad_constitucion: {
      tipo_documento: "documento_privado",
      fecha: "2013-10-18",
      camara_comercio_ciudad: "BOGOTA",
      camara_comercio_numero: "01775236",
      libro: "IX",
    },
  },
  poderdante: {
    representante_legal_nombre: "FELIX ROZO CAGUA",
    representante_legal_cedula: "79382406",
    representante_legal_cargo: "SUPLENTE DEL PRESIDENTE",
    representante_legal_cedula_expedida_en: "Bogotá D.C.",
  },
  instrumento: {
    escritura_num: "16390",
    fecha: "2025-09-18",
    notaria_numero: "29",
    notaria_ciudad: "Bogotá D.C.",
  },
  ciudad_firma: "Bogotá D.C.",
};

describe("prosaBancos: paridad byte-a-byte (snapshots congelados)", () => {
  it("NATURAL — comparecencia + antefirma + nota", () => {
    expect(daviviendaTemplate.renderComparecencia(ctxNatural)).toMatchSnapshot("natural.comparecencia");
    expect(daviviendaTemplate.renderAntefirma(ctxNatural)).toMatchSnapshot("natural.antefirma");
    expect(daviviendaTemplate.renderNotaAutorizacion(ctxNatural)).toMatchSnapshot("natural.notaAutorizacion");
  });

  it("JURIDICA limpia — comparecencia + antefirma + nota", () => {
    expect(daviviendaTemplate.renderComparecencia(ctxJuridica)).toMatchSnapshot("juridica.comparecencia");
    expect(daviviendaTemplate.renderAntefirma(ctxJuridica)).toMatchSnapshot("juridica.antefirma");
    expect(daviviendaTemplate.renderNotaAutorizacion(ctxJuridica)).toMatchSnapshot("juridica.notaAutorizacion");
  });

  it("NATURAL con notas adicionales del override — la nota se anexa al PRIMERO", () => {
    const override: ProsaApoderadoOverride = {
      notas_adicionales: "Se protocoliza igualmente certificación bancaria de saldo cero.",
    };
    const merged = mergeOverride(ctxNatural, override);
    const rendered = daviviendaTemplate.renderComparecencia(merged);
    expect(rendered.includes("Se protocoliza igualmente certificación bancaria de saldo cero.")).toBe(true);
    expect(rendered).toMatchSnapshot("natural.comparecencia.conNotas");
  });
});
