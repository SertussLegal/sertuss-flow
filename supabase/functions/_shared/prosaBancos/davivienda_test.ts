// ============================================================================
// Deno tests — Snapshot inmutable de la prosa canónica Davivienda.
// Fase B4 v7. Cualquier cambio requiere aprobación jurídica explícita.
// ============================================================================
import { assertStringIncludes, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { daviviendaTemplate } from "./davivienda.ts";
import { getProsaBanco } from "./index.ts";
import type { ProsaContext } from "./types.ts";

Deno.test("registry: resuelve Davivienda por NIT canónico y aliases", () => {
  assertEquals(getProsaBanco("860.034.313-7")?.nombreBanco, "BANCO DAVIVIENDA S.A.");
  assertEquals(getProsaBanco("860034313-7")?.nombreBanco, "BANCO DAVIVIENDA S.A.");
  assertEquals(getProsaBanco("8600343137")?.nombreBanco, "BANCO DAVIVIENDA S.A.");
  assertEquals(getProsaBanco("860.034.313")?.nombreBanco, "BANCO DAVIVIENDA S.A.");
  assertEquals(getProsaBanco("999999999-9"), null);
  assertEquals(getProsaBanco(null), null);
  assertEquals(getProsaBanco(""), null);
});

Deno.test("davivienda: prosa NATURAL cumple marcadores canónicos", () => {
  const ctx: ProsaContext = {
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
  const comparecencia = daviviendaTemplate.renderComparecencia(ctx);
  assertStringIncludes(comparecencia, "COMPARECIÓ: ANA MARIA MONTOYA ECHEVERRY");
  assertStringIncludes(comparecencia, "APODERADA GENERAL");
  assertStringIncludes(comparecencia, "BANCO DAVIVIENDA S.A.");
  assertStringIncludes(comparecencia, "NIT: 860.034.313-7");
  assertStringIncludes(comparecencia, "41939243");
  assertStringIncludes(comparecencia, "siete mil trescientos sesenta y cuatro (7364)");
  assertStringIncludes(comparecencia, "veintiséis (26) de mayo de dos mil veintitrés (2023)");
  assertStringIncludes(comparecencia, "notaría veintinueve (29)");

  const antefirma = daviviendaTemplate.renderAntefirma(ctx);
  assertStringIncludes(antefirma, "ANA MARIA MONTOYA ECHEVERRY");
  assertStringIncludes(antefirma, "C.C. No.41939243");
  assertStringIncludes(antefirma, "APODERADO GENERAL DE BANCO DAVIVIENDA S.A.");

  const nota = daviviendaTemplate.renderNotaAutorizacion(ctx);
  assertStringIncludes(nota, "ANA MARIA MONTOYA ECHEVERRY, APODERADA GENERAL");
  assertStringIncludes(nota, "AUTORIZA que el presente instrumento sea suscrito");
});

Deno.test("davivienda: prosa JURIDICA cumple marcadores canónicos con tracto 3 niveles", () => {
  const ctx: ProsaContext = {
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

  const comparecencia = daviviendaTemplate.renderComparecencia(ctx);
  assertStringIncludes(comparecencia, "COMPARECIÓ: LINA MAGALY CAMPOS LOSADA");
  assertStringIncludes(comparecencia, "en su calidad de representante legal de la sociedad CONECTIVA GLOBAL S.A.S.");
  assertStringIncludes(comparecencia, "NIT. 900.666.582-8");
  assertStringIncludes(comparecencia, "sociedad que actúa como apoderada general del BANCO DAVIVIENDA S.A.");
  assertStringIncludes(comparecencia, "como consta en el poder general conferido por el doctor FELIX ROZO CAGUA");
  assertStringIncludes(comparecencia, "obrando en su condición de suplente del presidente");
  assertStringIncludes(comparecencia, "escritura pública número dieciséis mil trescientos noventa (16390)");
  assertStringIncludes(comparecencia, "Notaría veintinueve (29) del Círculo de Bogotá D.C.");
  assertStringIncludes(comparecencia, "PROYECTOS LEGALES S.A.S.");

  const antefirma = daviviendaTemplate.renderAntefirma(ctx);
  assertStringIncludes(antefirma, "LINA MAGALY CAMPOS LOSADA");
  assertStringIncludes(antefirma, "C.C. No.55069433");
  assertStringIncludes(antefirma, "En calidad de representante legal de la sociedad CONECTIVA GLOBAL S.A.S.");
  assertStringIncludes(antefirma, "sociedad que a su vez obra en calidad de apoderada general de BANCO DAVIVIENDA S.A.");

  const nota = daviviendaTemplate.renderNotaAutorizacion(ctx);
  assertStringIncludes(nota, "LINA MAGALY CAMPOS LOSADA, en calidad de representante legal de la sociedad CONECTIVA GLOBAL S.A.S.");
  assertStringIncludes(nota, "apoderada general de BANCO DAVIVIENDA S.A.");
});
