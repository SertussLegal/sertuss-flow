// A1 (backend) — mergeRegenPayload: el modo `regen` de procesar-cancelacion
// debe rescatar el bloque profundo v6 aunque `data_final` histórico lo haya
// perdido (caso c8924aa2), y `overrides` NUNCA puede borrar claves que no
// envía.
import { describe, it, expect } from "vitest";
import { mergeRegenPayload } from "../../supabase/functions/_shared/isomorphic/mergeRegenPayload";

describe("A1 backend — mergeRegenPayload", () => {
  it("rescate profundo: data_final sin apoderado.sociedad_* lo recupera de data_ia", () => {
    const dataIa = {
      poder_banco: {
        apoderado_nombre: "LINA",
        apoderado: {
          tipo: "juridica",
          sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
          representantes: [{ nombre: "LINA", es_firmante: true }],
        },
        poderdante: { nombre: "DAVIVIENDA" },
        instrumento_poder: { escritura_num: "16390" },
      },
      hipoteca_anterior: { numero_escritura_hipoteca: "1000" },
    };
    const dataFinal = {
      poder_banco: { apoderado_nombre: "LINA MARIA CAMPOS" },
      hipoteca_anterior: { numero_escritura_hipoteca: "1000" },
    };
    const overrides = {
      poder_banco: { apoderado_notaria_poder: "NOTARÍA 29 BOGOTÁ" },
    };
    const out = mergeRegenPayload<any>({ dataIa, dataFinal, overrides }) as Record<string, any>;

    // Rescate profundo desde data_ia.
    expect(out.poder_banco.apoderado.sociedad_razon_social).toBe("CONECTIVA GLOBAL S.A.S.");
    expect(out.poder_banco.poderdante.nombre).toBe("DAVIVIENDA");
    expect(out.poder_banco.instrumento_poder.escritura_num).toBe("16390");
    // Edición previa (data_final) preservada.
    expect(out.poder_banco.apoderado_nombre).toBe("LINA MARIA CAMPOS");
    // Override actual del frontend aplicado.
    expect(out.poder_banco.apoderado_notaria_poder).toBe("NOTARÍA 29 BOGOTÁ");
  });

  it("no borrado: overrides sin poder_banco.apoderado profundo no elimina el bloque", () => {
    const dataIa = {
      poder_banco: { apoderado: { tipo: "juridica", sociedad_razon_social: "X" } },
    };
    const dataFinal = { poder_banco: { apoderado_nombre: "Y" } };
    const overrides = { poder_banco: { apoderado_nombre: "Z" } };
    const out = mergeRegenPayload<any>({ dataIa, dataFinal, overrides }) as Record<string, any>;
    expect(out.poder_banco.apoderado.sociedad_razon_social).toBe("X");
    expect(out.poder_banco.apoderado_nombre).toBe("Z");
  });

  it("sobreescritura permitida: overrides gana sobre data_final en el plano", () => {
    const dataIa = { poder_banco: { apoderado_nombre: "IA" } };
    const dataFinal = { poder_banco: { apoderado_nombre: "FINAL" } };
    const overrides = { poder_banco: { apoderado_nombre: "OV" } };
    const out = mergeRegenPayload<any>({ dataIa, dataFinal, overrides }) as Record<string, any>;
    expect(out.poder_banco.apoderado_nombre).toBe("OV");
  });

  it("otros bloques del payload: overrides gana sobre data_final", () => {
    const dataIa = { hipoteca_anterior: { valor: "IA" } };
    const dataFinal = { hipoteca_anterior: { valor: "FINAL" } };
    const overrides = { hipoteca_anterior: { valor: "OV" } };
    const out = mergeRegenPayload<any>({ dataIa, dataFinal, overrides }) as Record<string, any>;
    expect(out.hipoteca_anterior.valor).toBe("OV");
  });

  it("sin overrides: base = data_final ?? data_ia", () => {
    const dataIa = { poder_banco: { apoderado_nombre: "IA" } };
    const dataFinal = null;
    const out = mergeRegenPayload<any>({ dataIa, dataFinal, overrides: null }) as Record<string, any>;
    expect(out.poder_banco.apoderado_nombre).toBe("IA");
  });

  it("poderdante deep-merge: override parcial no borra menciones_rl ni otros escalares", () => {
    const dataIa = {
      poder_banco: {
        poderdante: {
          entidad_nombre: "DAVIVIENDA S.A.",
          entidad_nit: "860.034.313-7",
          representante_legal_nombre: "FELIX ROZO CAGUA",
          representante_legal_cedula: "79392406",
          menciones_rl: [
            { seccion: "cuerpo_poder", cedula: "79392406", pagina: 1 },
            { seccion: "certificado_superfinanciera", cedula: "79382406", pagina: 12 },
          ],
        },
      },
    };
    const dataFinal = {
      poder_banco: {
        poderdante: {
          entidad_nombre: "DAVIVIENDA S.A.",
          entidad_nit: "860.034.313-7",
          representante_legal_nombre: "FELIX ROZO CAGUA",
          representante_legal_cedula: "79392406",
          menciones_rl: [
            { seccion: "cuerpo_poder", cedula: "79392406", pagina: 1 },
            { seccion: "certificado_superfinanciera", cedula: "79382406", pagina: 12 },
          ],
        },
      },
    };
    // El frontend solo edita la cédula escalar del RL.
    const overrides = {
      poder_banco: {
        poderdante: { representante_legal_cedula: "79382406" },
      },
    };
    const out = mergeRegenPayload<any>({ dataIa, dataFinal, overrides }) as Record<string, any>;
    const pd = out.poder_banco.poderdante;
    // Override aplicado.
    expect(pd.representante_legal_cedula).toBe("79382406");
    // Escalares no tocados preservados.
    expect(pd.entidad_nombre).toBe("DAVIVIENDA S.A.");
    expect(pd.entidad_nit).toBe("860.034.313-7");
    expect(pd.representante_legal_nombre).toBe("FELIX ROZO CAGUA");
    // Evidencia forense intacta.
    expect(Array.isArray(pd.menciones_rl)).toBe(true);
    expect(pd.menciones_rl).toHaveLength(2);
    expect(pd.menciones_rl[1].cedula).toBe("79382406");
  });

  it("poderdante: sin overrides.poderdante, no se pierde el bloque de data_ia", () => {
    const dataIa = {
      poder_banco: {
        poderdante: {
          entidad_nombre: "BANCO",
          menciones_rl: [{ seccion: "cuerpo_poder", cedula: "1" }],
        },
      },
    };
    const dataFinal = null;
    const overrides = { poder_banco: { apoderado_nombre: "X" } };
    const out = mergeRegenPayload<any>({ dataIa, dataFinal, overrides }) as Record<string, any>;
    expect(out.poder_banco.apoderado_nombre).toBe("X");
    expect(out.poder_banco.poderdante.entidad_nombre).toBe("BANCO");
    expect(out.poder_banco.poderdante.menciones_rl).toHaveLength(1);
  });
});
