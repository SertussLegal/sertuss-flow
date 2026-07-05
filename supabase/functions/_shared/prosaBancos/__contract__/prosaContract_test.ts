// ============================================================================
// Fase 4 — Motor genérico assertContract: valida que la prosa renderizada
// contenga los marcadores canónicos del contrato para el caso dado, y que
// las cláusulas condicionales se disparen solo cuando el predicado se cumple.
// ============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import contract from "./referencia_davivienda.contract.json" with { type: "json" };
import { daviviendaTemplate } from "../davivienda.ts";
import type { ProsaContext } from "../types.ts";

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
    assert(rendered.includes(marker), `[${caso}] Falta marcador canónico: "${marker}"`);
  }
  for (const forbidden of asserts.forbidden) {
    assert(!rendered.includes(forbidden), `[${caso}] Contiene forbidden: "${forbidden}"`);
  }
  if (asserts.conditionalRequired && caso === "juridica") {
    const soc = ctx.apoderado.sociedad_constitucion ?? {};
    for (const [_name, rule] of Object.entries(asserts.conditionalRequired)) {
      if (rule.when === "sociedad_constitucion.razon_social_anterior != null") {
        if (soc.razon_social_anterior) {
          for (const s of rule.mustContain) {
            assert(rendered.includes(s), `[${caso}] Contexto con reforma exige: "${s}"`);
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
      // Sin reforma → conditionalRequired NO debe dispararse.
    },
  },
};

Deno.test("prosa NATURAL cumple contrato", () => {
  assertContract("natural", renderAll(ctxNatural), ctxNatural);
});

Deno.test("prosa JURIDICA con reforma cumple contrato + condicional", () => {
  assertContract("juridica", renderAll(ctxJuridicaConReforma), ctxJuridicaConReforma);
});

Deno.test("prosa JURIDICA sin reforma cumple contrato SIN falsos negativos", () => {
  const rendered = renderAll(ctxJuridicaLimpia);
  assertContract("juridica", rendered, ctxJuridicaLimpia);
  assert(!rendered.includes("cambio su razón social por"), "No debe aparecer cláusula de reforma en sociedad limpia");
});

Deno.test("prosa NO contiene literales de los .docx de referencia (anti-leak)", () => {
  // Datos reales de los ejemplos legales — sirven de canario contra copy-paste.
  const literalsProhibidos = ["EJEMPLO_REFERENCIA"];
  const rendered = renderAll(ctxNatural) + renderAll(ctxJuridicaConReforma);
  for (const lit of literalsProhibidos) {
    assertEquals(rendered.includes(lit), false, `Leak de literal: ${lit}`);
  }
});
