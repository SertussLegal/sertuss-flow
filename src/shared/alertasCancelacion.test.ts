// ============================================================================
// alertasCancelacion — modelo de alertas que reemplaza la compuerta de
// generación. Cubre clasificación, resolución de prioritarias, dedupe de
// NO_LEGIBLE y el blanqueo de decisiones pendientes.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  computeAlertas,
  contarPrioritarias,
  applyPendingDecisionBlanks,
  candidatoApoderadoConfirmado,
  cuantiaConflictoResuelto,
  CLASIFICACION_ALERTAS,
  CLASIFICACION_DEFAULT,
  CODIGO_CAMPO_NO_LEGIBLE,
  NO_LEGIBLE_PODER_PATHS,
} from "../../supabase/functions/_shared/isomorphic/alertasCancelacion";
import {
  CUANTIA_CONFLICTO_WARNING,
  CUANTIA_CONFLICTO_ORIGEN,
} from "../../supabase/functions/_shared/isomorphic/cuantiaConflicto";
import { HARD_BLOCK_WARNING_SUFFIXES } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

// deno-lint-ignore no-explicit-any
const base = (over: Record<string, unknown> = {}): Record<string, any> => ({
  partes: {},
  inmueble: {},
  hipoteca_anterior: {},
  poder_banco: {},
  ...over,
});

const conWarnings = (rama: string, warnings: string[], extra: Record<string, unknown> = {}) =>
  base({ [rama]: { _coherencia_warnings: warnings, ...extra } });

const codigos = (data: Record<string, unknown>) => computeAlertas(data).map((a) => a.codigo);
const buscar = (data: Record<string, unknown>, codigo: string) =>
  computeAlertas(data).find((a) => a.codigo === codigo);

describe("computeAlertas — clasificación", () => {
  it("clasifica el conflicto de cuantía como prioritaria y bloquea descarga", () => {
    const a = buscar(
      conWarnings("hipoteca_anterior", [CUANTIA_CONFLICTO_WARNING], {
        cuantia_origen: CUANTIA_CONFLICTO_ORIGEN,
      }),
      CUANTIA_CONFLICTO_WARNING,
    );
    expect(a?.categoria).toBe("prioritaria");
    expect(a?.bloqueaDescarga).toBe(true);
    expect(a?.seccion).toBe("hipoteca");
    expect(a?.descripcion).toMatch(/varias cifras/i);
  });

  it("clasifica menciones incoherentes como importante (no bloquea)", () => {
    const a = buscar(
      conWarnings("poder_banco", ["apoderado_cedula_menciones_incoherentes"]),
      "apoderado_cedula_menciones_incoherentes",
    );
    expect(a?.categoria).toBe("importante");
    expect(a?.bloqueaDescarga).toBe(false);
  });

  it("clasifica confianza baja como informativa", () => {
    const a = buscar(
      conWarnings("poder_banco", ["apoderado_cedula_confianza_baja"]),
      "apoderado_cedula_confianza_baja",
    );
    expect(a?.categoria).toBe("informativa");
    expect(a?.bloqueaDescarga).toBe(false);
  });

  it("un código desconocido cae en el default (importante/documento), nunca silencioso", () => {
    const a = buscar(conWarnings("poder_banco", ["codigo_futuro_inventado"]), "codigo_futuro_inventado");
    expect(a).toBeDefined();
    expect(a?.categoria).toBe(CLASIFICACION_DEFAULT.categoria);
    expect(a?.seccion).toBe(CLASIFICACION_DEFAULT.seccion);
    expect(a?.descripcion).toMatch(/sin catalogar/i);
  });

  it("ordena prioritarias antes que importantes e informativas", () => {
    const data = base({
      poder_banco: {
        _coherencia_warnings: [
          "apoderado_cedula_confianza_baja",
          "apoderado_cedula_menciones_incoherentes",
        ],
        apoderado_cedula: "NO_LEGIBLE",
      },
    });
    const cats = computeAlertas(data).map((a) => a.categoria);
    expect(cats[0]).toBe("prioritaria");
    expect(cats).toEqual(["prioritaria", "importante", "informativa"]);
  });

  it("no emite alertas cuando no hay warnings ni centinelas", () => {
    expect(computeAlertas(base())).toEqual([]);
    expect(computeAlertas(null)).toEqual([]);
  });
});

describe("computeAlertas — NO_LEGIBLE", () => {
  it("detecta el centinela en los paths del poder y lo marca prioritario", () => {
    const data = base({ poder_banco: { apoderado_cedula: "NO_LEGIBLE" } });
    const a = buscar(data, "apoderado_cedula_no_legible");
    expect(a?.categoria).toBe("prioritaria");
    expect(a?.detalle?.paths).toEqual(["poder_banco.apoderado_cedula"]);
  });

  it("dedupe: el warning persistido y el centinela vivo son una sola alerta", () => {
    const data = base({
      poder_banco: {
        _coherencia_warnings: ["apoderado_cedula_no_legible"],
        apoderado_cedula: "NO_LEGIBLE",
      },
    });
    expect(codigos(data).filter((c) => c === "apoderado_cedula_no_legible")).toHaveLength(1);
  });

  it("agrupa plano y anidado del mismo hecho en una alerta con ambos paths", () => {
    const data = base({
      poder_banco: { apoderado_cedula: "NO_LEGIBLE", apoderado: { cedula: "NO_LEGIBLE" } },
    });
    const a = buscar(data, "apoderado_cedula_no_legible");
    expect(a?.detalle?.paths).toEqual([
      "poder_banco.apoderado_cedula",
      "poder_banco.apoderado.cedula",
    ]);
  });

  it("un centinela en un path no catalogado emite campo_no_legible prioritario", () => {
    const data = base({ inmueble: { direccion: "NO_LEGIBLE" } });
    const a = buscar(data, CODIGO_CAMPO_NO_LEGIBLE);
    expect(a?.categoria).toBe("prioritaria");
    expect(a?.detalle?.paths).toContain("inmueble.direccion");
  });

  it("los 6 paths canónicos siguen siendo los del detector original", () => {
    expect([...NO_LEGIBLE_PODER_PATHS]).toEqual([
      "poder_banco.apoderado_cedula",
      "poder_banco.apoderado_escritura",
      "poder_banco.apoderado_fecha",
      "poder_banco.apoderado.cedula",
      "poder_banco.instrumento_poder.escritura_num",
      "poder_banco.instrumento_poder.fecha",
    ]);
  });
});

describe("computeAlertas — resolución de prioritarias", () => {
  const conCandidatos = (over: Record<string, unknown> = {}) =>
    base({
      poder_banco: {
        _coherencia_warnings: ["apoderado_natural_candidatos_requiere_confirmacion"],
        apoderado: {
          tipo: "natural",
          candidatos_natural: [{ cedula: "79.123.456" }, { cedula: "52987654" }],
          ...over,
        },
      },
    });

  it("sin confirmar → alerta prioritaria presente", () => {
    expect(codigos(conCandidatos())).toContain(
      "apoderado_natural_candidatos_requiere_confirmacion",
    );
  });

  it("confirmado con cédula vigente → la alerta desaparece", () => {
    const data = conCandidatos({ candidato_confirmado_cedula: "79123456" });
    expect(candidatoApoderadoConfirmado(data)).toBe(true);
    expect(codigos(data)).not.toContain("apoderado_natural_candidatos_requiere_confirmacion");
  });

  it("confirmación vieja que ya no está en la lista NO resuelve", () => {
    const data = conCandidatos({ candidato_confirmado_cedula: "11111111" });
    expect(candidatoApoderadoConfirmado(data)).toBe(false);
    expect(codigos(data)).toContain("apoderado_natural_candidatos_requiere_confirmacion");
  });

  it("cuantía: origen manual resuelve el conflicto", () => {
    const sinResolver = conWarnings("hipoteca_anterior", [CUANTIA_CONFLICTO_WARNING], {
      cuantia_origen: CUANTIA_CONFLICTO_ORIGEN,
    });
    const resuelto = conWarnings("hipoteca_anterior", [CUANTIA_CONFLICTO_WARNING], {
      cuantia_origen: "manual",
    });
    expect(codigos(sinResolver)).toContain(CUANTIA_CONFLICTO_WARNING);
    expect(cuantiaConflictoResuelto(resuelto)).toBe(true);
    expect(codigos(resuelto)).not.toContain(CUANTIA_CONFLICTO_WARNING);
  });

  it("contarPrioritarias cuenta solo las que bloquean", () => {
    const data = base({
      poder_banco: {
        _coherencia_warnings: ["apoderado_cedula_menciones_incoherentes"],
        apoderado_cedula: "NO_LEGIBLE",
      },
      hipoteca_anterior: {
        _coherencia_warnings: [CUANTIA_CONFLICTO_WARNING],
        cuantia_origen: CUANTIA_CONFLICTO_ORIGEN,
      },
    });
    expect(contarPrioritarias(computeAlertas(data))).toBe(2);
  });
});

describe("computeAlertas — avisos y contexto", () => {
  it("escritura_truncada entra como importante con su detalle", () => {
    const data = base({
      _avisos_procesamiento: { escritura_truncada: { paginas_en_storage: 186, paginas_usadas: 20 } },
    });
    const a = buscar(data, "escritura_truncada");
    expect(a?.categoria).toBe("importante");
    expect(a?.detalle?.paginas_usadas).toBe(20);
  });

  it("direccion_catastral_ocr entra como importante en la sección inmueble", () => {
    const data = base({ _avisos_procesamiento: { direccion_catastral_ocr: { motivo: "x" } } });
    expect(buscar(data, "direccion_catastral_ocr")?.seccion).toBe("inmueble");
  });

  it("aplica_ley_546 entra como informativa", () => {
    const data = base({ analisis_legal: { aplica_ley_546: true } });
    expect(buscar(data, "aplica_ley_546")?.categoria).toBe("informativa");
    expect(codigos(base({ analisis_legal: { aplica_ley_546: false } }))).toEqual([]);
  });
});

describe("computeAlertas — recálculo escalar", () => {
  it("un NIT incoherente ya corregido a mano deja de alertar", () => {
    const data = base({
      poder_banco: {
        _coherencia_warnings: ["poder_entidad_nit_incoherente"],
        poderdante: { entidad_nit: "860034313" },
      },
      partes: { banco_nit: "860.034.313", banco_acreedor: "DAVIVIENDA" },
    });
    expect(codigos(data)).not.toContain("poder_entidad_nit_incoherente");
  });
});

describe("cobertura: todo sufijo hard-block tiene clasificación", () => {
  it("cada código catalogado con sufijo hard-block es prioritaria o importante", () => {
    for (const [codigo, cls] of Object.entries(CLASIFICACION_ALERTAS)) {
      const esHardBlock = HARD_BLOCK_WARNING_SUFFIXES.some((s) => codigo.endsWith(s));
      if (esHardBlock) {
        expect(
          ["prioritaria", "importante"],
          `${codigo} no puede ser informativa`,
        ).toContain(cls.categoria);
      }
    }
  });
});

describe("applyPendingDecisionBlanks", () => {
  it("NUNCA muta la entrada", () => {
    const data = base({ poder_banco: { apoderado_cedula: "NO_LEGIBLE" } });
    const snapshot = JSON.stringify(data);
    applyPendingDecisionBlanks(data);
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it("la palabra NO_LEGIBLE no sobrevive en ninguna profundidad", () => {
    const data = base({
      poder_banco: {
        apoderado_cedula: "NO_LEGIBLE",
        apoderado: { cedula: "NO_LEGIBLE", nombre: "JUAN" },
        menciones: [{ valor: "NO_LEGIBLE" }, { valor: "13C-05" }],
      },
    });
    const { data: out, aplicados } = applyPendingDecisionBlanks(data);
    expect(JSON.stringify(out)).not.toContain("NO_LEGIBLE");
    expect(aplicados).toContain("no_legible_blanqueado");
    expect(out.poder_banco.apoderado.nombre).toBe("JUAN");
    expect(out.poder_banco.menciones[1].valor).toBe("13C-05");
  });

  it("apoderado multi-candidato sin confirmar sale en blanco (plano y anidado)", () => {
    const data = base({
      poder_banco: {
        apoderado_nombre: "MARIA PEREZ",
        apoderado_cedula: "52987654",
        apoderado: {
          tipo: "natural",
          nombre: "MARIA PEREZ",
          cedula: "52987654",
          candidatos_natural: [{ cedula: "79123456" }, { cedula: "52987654" }],
        },
      },
    });
    const { data: out, aplicados } = applyPendingDecisionBlanks(data);
    expect(out.poder_banco.apoderado_nombre).toBeUndefined();
    expect(out.poder_banco.apoderado_cedula).toBeUndefined();
    expect(out.poder_banco.apoderado.nombre).toBeUndefined();
    expect(out.poder_banco.apoderado.cedula).toBeUndefined();
    expect(aplicados).toContain("apoderado_candidato_sin_confirmar");
  });

  it("apoderado confirmado conserva sus datos", () => {
    const data = base({
      poder_banco: {
        apoderado_nombre: "MARIA PEREZ",
        apoderado_cedula: "52987654",
        apoderado: {
          tipo: "natural",
          nombre: "MARIA PEREZ",
          cedula: "52987654",
          candidato_confirmado_cedula: "52987654",
          candidatos_natural: [{ cedula: "79123456" }, { cedula: "52987654" }],
        },
      },
    });
    const { data: out, aplicados } = applyPendingDecisionBlanks(data);
    expect(out.poder_banco.apoderado_nombre).toBe("MARIA PEREZ");
    expect(aplicados).not.toContain("apoderado_candidato_sin_confirmar");
  });

  it("conflicto de cuantía sin resolver → cláusula NEUTRAL (vacío + no indeterminada)", () => {
    const data = base({
      hipoteca_anterior: {
        valor_hipoteca_original: "SIETE MILLONES ($7.968.114)",
        valor_hipoteca_es_indeterminada: true,
        cuantia_origen: CUANTIA_CONFLICTO_ORIGEN,
        hipoteca_garantia_abierta: true,
      },
    });
    const { data: out, aplicados } = applyPendingDecisionBlanks(data);
    expect(out.hipoteca_anterior.valor_hipoteca_original).toBe("");
    expect(out.hipoteca_anterior.valor_hipoteca_es_indeterminada).toBe(false);
    // Hecho textual leído de la escritura: no se toca.
    expect(out.hipoteca_anterior.hipoteca_garantia_abierta).toBe(true);
    expect(aplicados).toContain("cuantia_conflicto_sin_resolver");
  });

  it("cuantía resuelta a mano conserva el monto elegido", () => {
    const data = base({
      hipoteca_anterior: {
        valor_hipoteca_original: "TREINTA Y UN MILLONES ($31.113.670)",
        cuantia_origen: "manual",
      },
    });
    const { data: out, aplicados } = applyPendingDecisionBlanks(data);
    expect(out.hipoteca_anterior.valor_hipoteca_original).toBe(
      "TREINTA Y UN MILLONES ($31.113.670)",
    );
    expect(aplicados).toEqual([]);
  });
});
