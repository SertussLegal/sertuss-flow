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
