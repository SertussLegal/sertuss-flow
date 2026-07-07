// V6 extractor — merge determinista + buildPoderBancoRequest.
// Estos tests corren contra el módulo isomórfico (vitest) porque los tests
// Deno de procesar-cancelacion están bloqueados por errores TS preexistentes
// en otras áreas del index.ts (no relacionados con V6).
import { describe, it, expect } from "vitest";
import {
  mergePoderBancoV6,
  mergePoderBancoFlat,
  unwrapConf,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/merge";
import { buildPoderBancoRequest } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor";
import type { PoderBancoDeepPayload } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor";

describe("mergePoderBancoV6", () => {
  it("apoderado.tipo='juridica' con constitución completa se preserva", () => {
    const deep: PoderBancoDeepPayload = {
      entidad_bancaria: { valor: "BANCO DAVIVIENDA S.A.", confianza: "alta" },
      apoderado_nombre: { valor: "JUAN PEREZ", confianza: "alta" },
      apoderado_cedula: { valor: "79123456", confianza: "alta" },
      has_apoderado_banco_v3: "true",
      apoderado: {
        tipo: "juridica",
        sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
        sociedad_nit: "900666582-8",
        sociedad_constitucion: {
          camara_comercio_ciudad: "BOGOTA",
          camara_comercio_numero: "01775236",
        },
        representantes: [
          { nombre: "JUAN PEREZ", cedula: "79123456", cargo: "REPRESENTANTE LEGAL", es_firmante: true },
        ],
      },
    };
    const merged = mergePoderBancoV6(undefined, null, deep);
    expect(merged).toBeTruthy();
    expect((merged?.apoderado as { tipo?: string })?.tipo).toBe("juridica");
    expect(merged?.apoderado_nombre).toBe("JUAN PEREZ");
    expect(merged?.apoderado_cedula).toBe("79123456");
  });

  it("Fallback plano: tipo='juridica' sin apoderado_nombre usa el primer representante", () => {
    const deep: PoderBancoDeepPayload = {
      has_apoderado_banco_v3: "true",
      apoderado: {
        tipo: "juridica",
        sociedad_razon_social: "MI SOCIEDAD S.A.S.",
        sociedad_nit: "900123456-7",
        sociedad_constitucion: { camara_comercio_numero: "999" },
        representantes: [
          { nombre: "MARIA GOMEZ", cedula: "1032456789", cargo: "REPRESENTANTE LEGAL", es_firmante: true },
        ],
      },
    };
    const merged = mergePoderBancoV6(undefined, null, deep);
    expect(merged?.apoderado_nombre).toBe("MARIA GOMEZ");
    expect(merged?.apoderado_cedula).toBe("1032456789");
  });

  it("classifyApoderado degrada tipo='juridica' a null cuando faltan datos de constitución", () => {
    const deep: PoderBancoDeepPayload = {
      has_apoderado_banco_v3: "true",
      apoderado: {
        tipo: "juridica",
        representantes: [],
      },
    };
    const merged = mergePoderBancoV6(undefined, null, deep);
    expect((merged?.apoderado as { tipo?: string | null })?.tipo).toBeNull();
  });

  it("Caso Alejandra sintético: designación al final del PDF se preserva en formato notarial", () => {
    const deep: PoderBancoDeepPayload = {
      entidad_bancaria: { valor: "BANCO DAVIVIENDA S.A.", confianza: "alta" },
      apoderado_nombre: { valor: "LUISA FERNANDA RODRIGUEZ", confianza: "alta" },
      apoderado_cedula: { valor: "52789456", confianza: "alta" },
      escritura_poder_num: { valor: "DOS MIL CUATROCIENTOS QUINCE (2415)", confianza: "alta" },
      fecha_poder: { valor: "DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)", confianza: "alta" },
      notaria_poder: { valor: "TREINTA Y DOS (32) DE BOGOTA D.C.", confianza: "alta" },
      has_apoderado_banco_v3: "true",
      apoderado: { tipo: "natural", nombre: "LUISA FERNANDA RODRIGUEZ", cedula: "52789456" },
      instrumento_poder: {
        escritura_num: "2415",
        fecha: "2025-08-19",
        notaria_numero: "32",
        notaria_ciudad: "BOGOTA D.C.",
      },
    };
    const merged = mergePoderBancoV6(undefined, null, deep);
    expect(merged?.apoderado_nombre).toBe("LUISA FERNANDA RODRIGUEZ");
    expect(merged?.apoderado_escritura).toContain("2415");
    expect(merged?.apoderado_notaria_poder).toContain("TREINTA Y DOS");
    expect((merged?.instrumento_poder as { notaria_numero?: string })?.notaria_numero).toBe("32");
  });

  it("Humano/monolítico gana sobre v6 profundo en campos planos legacy", () => {
    const mono = { apoderado_nombre: "NOMBRE HUMANO EDITADO" };
    const deep: PoderBancoDeepPayload = {
      apoderado_nombre: { valor: "NOMBRE IA", confianza: "alta" },
      has_apoderado_banco_v3: "true",
      apoderado: { tipo: "natural", nombre: "NOMBRE IA" },
    };
    const merged = mergePoderBancoV6(mono, null, deep);
    expect(merged?.apoderado_nombre).toBe("NOMBRE HUMANO EDITADO");
  });

  it("Sin deepV6, delega a merge plano legacy (cero regresión)", () => {
    const mono = { apoderado_nombre: "SOLO MONO" };
    const dedic = { apoderado_cedula: "111" };
    const merged = mergePoderBancoV6(mono, dedic, null);
    expect(merged?.apoderado_nombre).toBe("SOLO MONO");
    expect(merged?.apoderado_cedula).toBe("111");
    // No debe existir bloque profundo cuando deepV6 es null.
    expect((merged as Record<string, unknown>)?.apoderado).toBeUndefined();
  });

  it("V6-wins natural: cedula de deepV6 sobrescribe monolítico cuando tipo='natural'", () => {
    const mono = { apoderado_nombre: "ANA MARIA MONTOYA", apoderado_cedula: "79.123.456" };
    const deep: PoderBancoDeepPayload = {
      has_apoderado_banco_v3: "true",
      instrumento_poder: { escritura_num: "1234", fecha: "2025-01-01", notaria_numero: "5", notaria_ciudad: "BOGOTA" },
      apoderado: { tipo: "natural", nombre: "ANA MARIA MONTOYA ECHEVERRY", cedula: "52219803" },
    };
    const merged = mergePoderBancoV6(mono, null, deep);
    expect(merged?.apoderado_cedula).toBe("52219803");
    expect(merged?.apoderado_nombre).toBe("ANA MARIA MONTOYA ECHEVERRY");
  });

  it("V6-wins jurídica: prefiere representante con es_firmante=true sobre el primero", () => {
    const mono = { apoderado_nombre: "OTRA PERSONA", apoderado_cedula: "111" };
    const deep: PoderBancoDeepPayload = {
      has_apoderado_banco_v3: "true",
      apoderado: {
        tipo: "juridica",
        sociedad_razon_social: "MI SOCIEDAD S.A.S.",
        sociedad_nit: "900123456-7",
        sociedad_constitucion: { camara_comercio_numero: "999" },
        representantes: [
          { nombre: "SUPLENTE UNO", cedula: "222", cargo: "SUPLENTE", es_firmante: false },
          { nombre: "REP PRINCIPAL", cedula: "333", cargo: "REP LEGAL", es_firmante: true },
        ],
      },
    };
    const merged = mergePoderBancoV6(mono, null, deep);
    expect(merged?.apoderado_nombre).toBe("REP PRINCIPAL");
    expect(merged?.apoderado_cedula).toBe("333");
  });

  it("V6 degradado (tipo=null): mantiene monolítico, no aplica override", () => {
    const mono = { apoderado_nombre: "MONO NOMBRE", apoderado_cedula: "999" };
    const deep: PoderBancoDeepPayload = {
      has_apoderado_banco_v3: "true",
      apoderado: { tipo: "juridica", representantes: [] },
    };
    const merged = mergePoderBancoV6(mono, null, deep);
    expect(merged?.apoderado_nombre).toBe("MONO NOMBRE");
    expect(merged?.apoderado_cedula).toBe("999");
    expect((merged?.apoderado as { tipo?: string | null })?.tipo).toBeNull();
  });

  it("V6 apagado (deepV6=null): comportamiento legacy intacto", () => {
    const mono = { apoderado_nombre: "LEGACY", apoderado_cedula: "555" };
    const merged = mergePoderBancoV6(mono, null, null);
    expect(merged?.apoderado_nombre).toBe("LEGACY");
    expect(merged?.apoderado_cedula).toBe("555");
    expect((merged as Record<string, unknown>)?.apoderado).toBeUndefined();
  });
});


describe("mergePoderBancoFlat", () => {
  it("prioriza monolítico sobre dedicado", () => {
    const out = mergePoderBancoFlat({ apoderado_nombre: "A" }, { apoderado_nombre: "B" });
    expect(out?.apoderado_nombre).toBe("A");
  });

  it("dedicado rellena huecos del monolítico", () => {
    const out = mergePoderBancoFlat({ apoderado_nombre: "" }, { apoderado_nombre: "B" });
    expect(out?.apoderado_nombre).toBe("B");
  });

  it("devuelve undefined si todo es vacío", () => {
    expect(mergePoderBancoFlat(undefined, null)).toBeUndefined();
  });
});

describe("unwrapConf", () => {
  it("unwraps {valor, confianza}", () => {
    expect(unwrapConf({ valor: "X", confianza: "alta" })).toBe("X");
  });
  it("returns string as-is", () => {
    expect(unwrapConf("X")).toBe("X");
  });
  it("returns undefined for null/empty", () => {
    expect(unwrapConf(null)).toBeUndefined();
    expect(unwrapConf({ valor: "" })).toBeUndefined();
  });
  it("sanea marcadores literales 'null'/'NULL'/'N/A'/'---'", () => {
    expect(unwrapConf("null")).toBeUndefined();
    expect(unwrapConf("NULL")).toBeUndefined();
    expect(unwrapConf("N/A")).toBeUndefined();
    expect(unwrapConf("---")).toBeUndefined();
    expect(unwrapConf({ valor: "null" })).toBeUndefined();
    expect(unwrapConf({ valor: "  n/a  " })).toBeUndefined();
  });
});

describe("mergePoderBancoV6 saneo de 'null' literal", () => {
  it("flat con 'null' literal se convierte a undefined", () => {
    const merged = mergePoderBancoFlat(
      { apoderado_nombre: "null", apoderado_cedula: "N/A" },
      { apoderado_nombre: "ANA MARIA", apoderado_cedula: "52857443" },
    );
    expect(merged?.apoderado_nombre).toBe("ANA MARIA");
    expect(merged?.apoderado_cedula).toBe("52857443");
  });
});


describe("buildPoderBancoRequest", () => {
  it("construye el body OpenAI con schema v6 y tool_choice fijado", () => {
    const body = buildPoderBancoRequest({ imageUrls: ["data:image/jpeg;base64,AAA"] });
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.tool_choice.function.name).toBe("extract_poder_banco");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    // El schema profundo debe incluir la propiedad `apoderado.tipo` con enum natural/juridica.
    const tool = body.tools[0] as { function: { parameters: { properties: Record<string, unknown> } } };
    const apoderadoProp = tool.function.parameters.properties.apoderado as { properties: { tipo: { enum: string[] } } };
    expect(apoderadoProp.properties.tipo.enum).toEqual(["natural", "juridica"]);
  });

  it("lanza si imageUrls está vacío", () => {
    expect(() => buildPoderBancoRequest({ imageUrls: [] })).toThrow();
  });
});
