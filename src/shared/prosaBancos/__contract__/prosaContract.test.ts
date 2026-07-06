// ============================================================================
// prosaContract.test.ts (Vitest) — Espejo del test Deno.
// Valida que la prosa renderizada contenga los marcadores canónicos del
// contrato y que las cláusulas condicionales se disparen correctamente.
// ============================================================================

import { describe, it, expect } from "vitest";
import contract from "./referencia_davivienda.contract.json";
import { daviviendaTemplate } from "@shared/prosaBancos/davivienda";
import type { ProsaContext } from "@shared/prosaBancos/types";

function renderAll(ctx: ProsaContext): string {
  return [
    daviviendaTemplate.renderComparecencia(ctx),
    daviviendaTemplate.renderAntefirma(ctx),
    daviviendaTemplate.renderNotaAutorizacion(ctx),
  ].join("\n");
}

function assertContract(caso: "natural" | "juridica", rendered: string, ctx: ProsaContext) {
  const asserts = (contract.prosaAsserts as Record<string, {
    required: string[];
    forbidden: string[];
    conditionalRequired?: Record<string, { when: string; mustContain: string[] }>;
  }>)[caso];

  for (const marker of asserts.required) {
    expect(rendered.includes(marker), `[${caso}] Falta marcador canónico: "${marker}"`).toBe(true);
  }
  for (const forbidden of asserts.forbidden) {
    expect(rendered.includes(forbidden), `[${caso}] Contiene forbidden: "${forbidden}"`).toBe(false);
  }
  if (asserts.conditionalRequired && caso === "juridica") {
    const soc = ctx.apoderado.sociedad_constitucion ?? {};
    for (const [, rule] of Object.entries(asserts.conditionalRequired)) {
      if (rule.when === "sociedad_constitucion.razon_social_anterior != null") {
        if (soc.razon_social_anterior) {
          for (const s of rule.mustContain) {
            expect(rendered.includes(s), `[${caso}] Reforma exige: "${s}"`).toBe(true);
          }
        }
      }
    }
  }
}

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

const ctxJuridicaConReforma: ProsaContext = {
  apoderado: {
    tipo: "juridica",
    nombre: "LINA MAGALY CAMPOS LOSADA",
    cedula: "55069433",
    sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
    sociedad_nit: "900.666.582-8",
    sociedad_constitucion: {
      tipo_documento: "documento_privado",
      fecha: "2013-10-18",
      fecha_texto: "dieciocho (18) de octubre de dos mil trece (2013)",
      camara_comercio_ciudad: "BOGOTA",
      camara_comercio_fecha: "2013-10-21",
      camara_comercio_numero: "01775236",
      libro: "IX",
      razon_social_anterior: "PROYECTOS LEGALES S.A.S.",
      reforma_acta_numero: "3",
      reforma_acta_fecha_texto: "doce (12) de diciembre de dos mil veintitrés (2023)",
      reforma_camara_fecha_texto: "veinticuatro (24) de julio de dos mil veinticinco (2025)",
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

const ctxJuridicaLimpia: ProsaContext = {
  ...ctxJuridicaConReforma,
  apoderado: {
    ...ctxJuridicaConReforma.apoderado,
    sociedad_constitucion: {
      tipo_documento: "documento_privado",
      fecha: "2013-10-18",
      fecha_texto: "dieciocho (18) de octubre de dos mil trece (2013)",
      camara_comercio_ciudad: "BOGOTA",
      camara_comercio_fecha: "2013-10-21",
      camara_comercio_numero: "01775236",
      libro: "IX",
    },
  },
};

describe("prosaBancos: contrato Davivienda (Vitest, paridad con Deno)", () => {
  it("NATURAL cumple contrato", () => {
    assertContract("natural", renderAll(ctxNatural), ctxNatural);
  });
  it("JURIDICA con reforma cumple contrato + condicional", () => {
    assertContract("juridica", renderAll(ctxJuridicaConReforma), ctxJuridicaConReforma);
  });
  it("JURIDICA sin reforma cumple SIN falsos negativos", () => {
    const rendered = renderAll(ctxJuridicaLimpia);
    assertContract("juridica", rendered, ctxJuridicaLimpia);
    expect(rendered.includes("cambio su razón social por")).toBe(false);
  });
  it("no contiene literales de los .docx de referencia (anti-leak)", () => {
    const rendered = renderAll(ctxNatural) + renderAll(ctxJuridicaConReforma);
    expect(rendered.includes("EJEMPLO_REFERENCIA")).toBe(false);
  });
});
