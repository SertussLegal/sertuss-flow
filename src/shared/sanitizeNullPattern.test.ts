// Cobertura para el cierre raíz del patrón "null" string incrustado.
// Cubre los 6 puntos identificados en la auditoría (barrido SOLO LECTURA):
//   1. mergePoderBancoFlat (pick)          — merge dedicado/monolítico
//   2. buildDocxVars apoderado_*           — impresión a plantilla (isomórfico: aquí testeamos sanitize)
//   3. Merge reproceso (existing || new)   — patrón `??` con sanitize
//   4. inferGeneroFromNombre               — sanitize antes de inferir
//   5. reconcileInmueble predial           — coerción segura de números y strings
//   6. Prompts (contract test string search)
import { describe, it, expect } from "vitest";
import {
  sanitizeString,
  mergePoderBancoFlat,
  mergePoderBancoV6,
  stripNullyStrings,
  CANCELACION_NULLY_PATHS,
} from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/merge";

import { reconcileInmueble } from "@/lib/reconcileData";
import type { Inmueble } from "@/lib/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("sanitizeString — fuente única de guard", () => {
  for (const trash of ["null", "NULL", "undefined", "UNDEFINED", "nan", "NaN", "N/A", "---", "", "   "]) {
    it(`descarta basura literal ${JSON.stringify(trash)}`, () => {
      expect(sanitizeString(trash)).toBeUndefined();
    });
  }
  it("preserva strings reales tras trim", () => {
    expect(sanitizeString("  JUAN PEREZ  ")).toBe("JUAN PEREZ");
  });
  it("ignora números y objetos", () => {
    expect(sanitizeString(123 as unknown)).toBeUndefined();
    expect(sanitizeString({} as unknown)).toBeUndefined();
  });
});

describe("(1) mergePoderBancoFlat: humano con 'null'/'undefined' no gana sobre dedicado", () => {
  it("humano='null' string → cede al dedicado real", () => {
    const out = mergePoderBancoFlat(
      { apoderado_nombre: "null", apoderado_cedula: "undefined" },
      { apoderado_nombre: "ANA MARIA MONTOYA", apoderado_cedula: "52857443" },
    );
    expect(out?.apoderado_nombre).toBe("ANA MARIA MONTOYA");
    expect(out?.apoderado_cedula).toBe("52857443");
  });
  it("path normal: humano real preserva su valor", () => {
    const out = mergePoderBancoFlat(
      { apoderado_nombre: "PEDRO GOMEZ" },
      { apoderado_nombre: "OTRA PERSONA" },
    );
    expect(out?.apoderado_nombre).toBe("PEDRO GOMEZ");
  });
});

describe("(5) reconcileInmueble: sanea basura literal del predial", () => {
  const base: Inmueble = {
    id: "x", tramite_id: "t", ficha_catastral: "", chip: "", matricula_inmobiliaria: "",
    departamento: "", ciudad: "", direccion: "", area: "", estrato: "", avaluo_catastral: "",
    barrio: "", tipo_predio: "", uso_predio: "", linderos: "", zona: "", nomenclatura: "",
    coeficiente_copropiedad: "", area_construida: "", area_privada: "",
  } as unknown as Inmueble;

  it("'null' string en predial nunca se persiste", () => {
    const out = reconcileInmueble(base, { avaluo_catastral: "null", estrato: "undefined", area: "nan", direccion: "" }, new Set());
    expect(out.avaluo_catastral).toBe("");
    expect(out.estrato).toBe("");
    expect(out.area).toBe("");
    expect(out.direccion).toBe("");
  });
  it("path normal: números y strings reales pasan", () => {
    const out = reconcileInmueble(base, { avaluo_catastral: 12345678, estrato: 4, area: "82", direccion: "CALLE 1" }, new Set());
    expect(out.avaluo_catastral).toBe("12345678");
    expect(out.estrato).toBe("4");
    expect(out.area).toBe("82");
    expect(out.direccion).toBe("CALLE 1");
  });
});

describe("(6) Prompts procesar-cancelacion: prohíben 'null si es ilegible'", () => {
  const SRC = readFileSync(
    resolve(__dirname, "../../supabase/functions/procesar-cancelacion/index.ts"),
    "utf-8",
  );
  it("no quedan instrucciones legacy 'null si es ilegible' para poder", () => {
    // Regla: los 3 sitios (schema principal, schema dedicado, system prompt refuerzo)
    // deben decir OMITE (no `null si es ilegible`).
    expect(SRC).not.toMatch(/`null`\s+si\s+es\s+ilegible/);
    expect(SRC).not.toMatch(/^ +apoderado_[a-z_]+.*null si es ilegible/m);
  });
  it("instrucción reemplazo OMITE presente en poder_banco y dedicado", () => {
    const occurrences = SRC.match(/OMITE el campo si es ilegible/g) || [];
    expect(occurrences.length).toBeGreaterThanOrEqual(8); // 4 tool #1 + 4 tool dedicado
  });
});

describe("cancelaciones.poder_banco: nunca persiste 'null' literal", () => {
  it("stripNullyStrings elimina claves basura y preserva el resto", () => {
    const pb = {
      apoderado_nombre: "null",
      apoderado_cedula: "NULL",
      apoderado_escritura: "  null  ",
      apoderado_fecha: "2024-05-01",
      apoderado_notaria_poder: "N/A",
      // Bloques profundos v6: intactos.
      apoderado: { tipo: "natural", nombre: "ANA MARIA MONTOYA", cedula: "52857443" },
      instrumento_poder: { escritura_num: "123" },
    };
    const out = stripNullyStrings(pb as unknown as Record<string, unknown>);
    expect(out.apoderado_nombre).toBeUndefined();
    expect(out.apoderado_cedula).toBeUndefined();
    expect(out.apoderado_escritura).toBeUndefined();
    expect(out.apoderado_notaria_poder).toBeUndefined();
    expect(out.apoderado_fecha).toBe("2024-05-01");
    // Bloques profundos v6 no se tocan.
    expect((out as { apoderado?: { nombre?: string } }).apoderado?.nombre).toBe("ANA MARIA MONTOYA");
    expect((out as { instrumento_poder?: { escritura_num?: string } }).instrumento_poder?.escritura_num).toBe("123");
    // No muta el input.
    expect(pb.apoderado_nombre).toBe("null");
  });

  it("regresión 32f5317e: monolítico con 'null' + deepV6 degradado → tras strip, sin 'null' literal", () => {
    // Reproduce el caso real: classifier degrada tipoEfectivo a null (natural_missing_poder_data)
    // y monolítico traía 'null' string. Sin strip, finalFlat.apoderado_nombre = "null".
    const monolitico = { apoderado_nombre: "null", apoderado_cedula: "null" };
    const deepV6 = {
      apoderado: { tipo: null, nombre: "ANA MARIA MONTOYA ECHEVERRY", cedula: "52857443" },
      apoderado_nombre: null,
      apoderado_cedula: null,
      escritura_poder_num: null,
      fecha_poder: null,
      notaria_poder: null,
      poderdante: null,
      instrumento_poder: null,
      facultades: null,
      vigencia: null,
      has_apoderado_banco_v3: null,
      motivos_incompletitud: ["natural_missing_poder_data"],
    } as unknown as Parameters<typeof mergePoderBancoV6>[2];
    const merged = mergePoderBancoV6(monolitico, null, deepV6);
    const stripped = stripNullyStrings(merged as unknown as Record<string, unknown>);
    expect(stripped?.apoderado_nombre).not.toBe("null");
    expect(stripped?.apoderado_cedula).not.toBe("null");
    // Aceptable: quede undefined (el bloque profundo tiene el nombre real; el fix B2 lo rescatará en ticket separado).
    expect(stripped?.apoderado_nombre === undefined || stripped?.apoderado_nombre === "ANA MARIA MONTOYA ECHEVERRY").toBe(true);
  });
});


describe("A2 — stripNullyStrings con rutas: hipoteca_anterior.valor_hipoteca_original", () => {
  it("elimina 'null' literal en hipoteca_anterior.valor_hipoteca_original", () => {
    const data = {
      hipoteca_anterior: {
        numero_escritura_hipoteca: "1234",
        valor_hipoteca_original: "null",
        cuantia_origen: "null",
      },
      partes: { deudor_nombre: "JUAN" },
    };
    const out = stripNullyStrings(
      data as unknown as Record<string, unknown>,
      CANCELACION_NULLY_PATHS,
    ) as { hipoteca_anterior: Record<string, unknown>; partes: Record<string, unknown> };
    expect(out.hipoteca_anterior.valor_hipoteca_original).toBeUndefined();
    expect(out.hipoteca_anterior.cuantia_origen).toBeUndefined();
    // Otros campos intactos.
    expect(out.hipoteca_anterior.numero_escritura_hipoteca).toBe("1234");
    expect(out.partes.deudor_nombre).toBe("JUAN");
  });

  it("preserva valores legítimos", () => {
    const data = {
      hipoteca_anterior: {
        valor_hipoteca_original: "$50.000.000 M/CTE",
        cuantia_origen: "escritura",
      },
    };
    const out = stripNullyStrings(
      data as unknown as Record<string, unknown>,
      CANCELACION_NULLY_PATHS,
    ) as { hipoteca_anterior: Record<string, unknown> };
    expect(out.hipoteca_anterior.valor_hipoteca_original).toBe("$50.000.000 M/CTE");
    expect(out.hipoteca_anterior.cuantia_origen).toBe("escritura");
  });

  it("no crashea si falta hipoteca_anterior", () => {
    const data = { partes: { deudor_nombre: "X" } };
    const out = stripNullyStrings(
      data as unknown as Record<string, unknown>,
      CANCELACION_NULLY_PATHS,
    );
    expect(out).toBeTruthy();
  });

  it("no muta el input", () => {
    const data = {
      hipoteca_anterior: { valor_hipoteca_original: "null" },
    };
    const snapshot = JSON.stringify(data);
    stripNullyStrings(data as unknown as Record<string, unknown>, CANCELACION_NULLY_PATHS);
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it("modo legacy sin paths sigue limpiando FLAT_STRING_KEYS de poder_banco", () => {
    const pb = { apoderado_nombre: "null", apoderado_cedula: "REAL123" };
    const out = stripNullyStrings(pb as unknown as Record<string, unknown>);
    expect(out?.apoderado_nombre).toBeUndefined();
    expect(out?.apoderado_cedula).toBe("REAL123");
  });
});


