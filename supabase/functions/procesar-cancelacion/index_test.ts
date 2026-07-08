// Tests deterministas para la cirugía v2 (Cancelaciones Davivienda).
// Caso real: Escritura 3866, Notaría 72, año 2011, Anotaciones 0007 y 0008.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDireccionCompletaSaneada,
  buildClausulaPagoHipoteca,
  buildClausulaLimitacionesSubsisten,
  buildDocxVars,
  mergeCuantiaIntoExtracted,
  pad4,
} from "./index.ts";

// Factory mínima para buildDocxVars — sólo campos consumidos en las ramas relevantes.
// deno-lint-ignore no-explicit-any
function minimalData(overrides: Record<string, unknown> = {}): any {
  return {
    hipoteca_anterior: {
      numero_escritura_hipoteca: "3866",
      fecha_escritura_hipoteca: "01/01/2011",
      notaria_hipoteca: "NOTARIA 72 DE BOGOTA",
      valor_hipoteca_original: "",
      valor_hipoteca_es_indeterminada: false,
      ...(overrides as Record<string, unknown>),
    },
    inmueble: { matricula_inmobiliaria: "", ciudad: "BOGOTA D.C.", departamento: "" },
    partes: { deudor_nombre: "X", deudor_identificacion: "1", deudor_tipo_id: "CC", banco_acreedor: "BANCO DAVIVIENDA S.A.", banco_nit: "860034313-7" },
    analisis_legal: { aplica_ley_546: false, explicacion_ley: "" },
    notaria_emisora: {},
    poder_banco: {},
  };
}


Deno.test("1) Bogotá: dirección saneada incluye '(DIRECCION CATASTRAL)' una sola vez", () => {
  const out = buildDireccionCompletaSaneada({
    nomenclaturaBase: "CALLE 66 C NUMERO 60-65",
    ciudad: "BOGOTA D.C.",
    departamento: "",
    esBogota: true,
  });
  assertEquals(out, "CALLE 66 C NUMERO 60-65 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C.");
  const matches = out!.match(/BOGOTA/g) || [];
  assertEquals(matches.length, 1, "BOGOTA no debe duplicarse");
  assert(!out!.includes("{ciudad_inmueble}"), "tag crudo no debe sobrevivir");
});

Deno.test("2) SNR atómico: pad4 produce 4 dígitos (escritura, notaría, anotaciones)", () => {
  assertEquals(pad4("3866"), "3866");
  assertEquals(pad4("72"), "0072");
  assertEquals(pad4(7), "0007");
  assertEquals(pad4(8), "0008");
  assertEquals(pad4(""), "");
  assertEquals(pad4(undefined), "");
});

Deno.test("3) Cuantía indeterminada → cláusula sin '$' ni '___'", () => {
  const txt = buildClausulaPagoHipoteca({ esCuantiaIndeterminada: true, valorRaw: "" });
  assert(!txt.includes("$"), "no debe contener '$'");
  assert(!txt.includes("___"), "no debe contener subrayados");
  assertStringIncludes(txt, "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA");
});

Deno.test("4) Limitaciones concurrentes: ambas leyes → cláusula completa", () => {
  const cl = buildClausulaLimitacionesSubsisten({
    concurre_afectacion_vivienda: true,
    afectacion_vivienda_anotacion: "0007",
    concurre_patrimonio_familia: true,
    patrimonio_familia_anotacion: "0008",
  });
  assert(cl, "debe devolver cláusula");
  assertStringIncludes(cl!, "Ley 258 de 1996");
  assertStringIncludes(cl!, "Ley 70 de 1931");
  assertStringIncludes(cl!, "Ley 495 de 1999");
  assertStringIncludes(cl!, "0007");
  assertStringIncludes(cl!, "0008");
});

Deno.test("5) Override manual: cuantía pasa de indeterminada a fija → cláusula recalcula con monto", () => {
  // Simula edición manual del abogado tras reliquidación.
  const txt = buildClausulaPagoHipoteca({
    esCuantiaIndeterminada: false,
    valorRaw: "CIENTO VEINTE MILLONES DE PESOS ($120.000.000)",
  });
  assert(!txt.includes("INDETERMINADA"), "no debe seguir hablando de indeterminada");
  assertStringIncludes(txt, "120.000.000");
});

Deno.test("6) Provincia (Villeta): sin '(DIRECCION CATASTRAL)', con departamento", () => {
  const out = buildDireccionCompletaSaneada({
    nomenclaturaBase: "CARRERA 5 NUMERO 3-21",
    ciudad: "VILLETA",
    departamento: "CUNDINAMARCA",
    esBogota: false,
  });
  assertEquals(out, "CARRERA 5 NUMERO 3-21 DE LA CIUDAD Y/O MUNICIPIO DE VILLETA DEPARTAMENTO DE CUNDINAMARCA");
  assert(!out!.includes("(DIRECCION CATASTRAL)"), "coletilla catastral solo aplica en Bogotá");
});

Deno.test("7) Sin limitaciones → cláusula undefined (parágrafo no se renderiza)", () => {
  const cl = buildClausulaLimitacionesSubsisten({
    concurre_afectacion_vivienda: false,
    concurre_patrimonio_familia: false,
  });
  assertEquals(cl, undefined);
});

// ─────────────────────────────────────────────────────────────────────
// Contrato de segregación topológica (postal vs arquitectónica)
// Caso canónico Calle 59 Sur 60-84 Torre 5 Apartamento 501.
// Valida que prompt + schema codifiquen la regla "índice más alto +
// formato notarial + strip arquitectónico" para que Gemini no devuelva
// la nomenclatura contaminada con TORRE/APARTAMENTO.
// ─────────────────────────────────────────────────────────────────────
const SRC = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("8) Schema nomenclatura_predio: ejemplo canónico 59 SUR 60-84 presente", () => {
  assertStringIncludes(
    SRC,
    "CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA GUION OCHENTA Y CUATRO (59 SUR No. 60-84)",
  );
});

Deno.test("9) Schema nomenclatura_predio: prohíbe complementos arquitectónicos y catastral", () => {
  // El description del schema debe nombrar la prohibición y la regla de índice más alto.
  assertStringIncludes(SRC, "ÍNDICE MÁS ALTO");
  assertStringIncludes(SRC, "apartamento/torre/interior/bloque/manzana/casa");
  assertStringIncludes(SRC, "(DIRECCION CATASTRAL)");
});

Deno.test("10) SYSTEM_PROMPT: 5 sub-reglas de nomenclatura (índice, cardinales, letras, guion, strip)", () => {
  assertStringIncludes(SRC, "REGLAS DE EXTRACCIÓN DE NOMENCLATURA DESDE EL CERTIFICADO DE TRADICIÓN");
  assertStringIncludes(SRC, "STRIP DE BASURA");
  assertStringIncludes(SRC, "Cardinales masculinos");
  assertStringIncludes(SRC, "GUION");
  assertStringIncludes(SRC, "TORRE <letras> (N)");
  assertStringIncludes(SRC, "APARTAMENTO <letras> (N)");
});

Deno.test("11) Segregación: TORRE/APARTAMENTO se reubican en descripcion_predio (no en nomenclatura)", () => {
  // descripcion_predio debe describir que captura los complementos arquitectónicos
  // y aplicar el mismo formato TEXTO (NÚMERO) — esto es lo que produce
  // "TORRE CINCO (5) APARTAMENTO QUINIENTOS UNO (501)" en el JSON de Gemini.
  assertStringIncludes(SRC, "Identificación ARQUITECTÓNICA del predio en formato notarial");
  assertStringIncludes(SRC, "reubícalos en su campo correspondiente");
});


// ─────────────────────────────────────────────────────────────────────
// Fix H2 — bug legal "null" en minuta de cancelaciones
// ─────────────────────────────────────────────────────────────────────

Deno.test("H2-1) mergeCuantiaIntoExtracted: dedicado confirma indeterminada → flag=true, monto vacío real", () => {
  const extracted = minimalData();
  const res = mergeCuantiaIntoExtracted(extracted, {
    valor_hipoteca_original: null,
    valor_hipoteca_es_indeterminada: true,
    motivo_null: "escritura_declara_abierta",
    // deno-lint-ignore no-explicit-any
  } as any);
  assertEquals(res.applied, true);
  assertEquals(res.monto, null);
  assertEquals(extracted.hipoteca_anterior.valor_hipoteca_original, "");
  assertEquals(extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada, true);
  assertEquals(extracted.hipoteca_anterior.cuantia_origen, "escritura");
});

Deno.test("H2-2) buildDocxVars: basura 'null' + flag false → jamás emite la palabra 'null'", () => {
  const vars = buildDocxVars(minimalData({ valor_hipoteca_original: "null", valor_hipoteca_es_indeterminada: false }));
  assertEquals(vars.valor_hipoteca_original, undefined);
  // deno-lint-ignore no-explicit-any
  const clausula = String((vars as any).clausula_pago_hipoteca ?? "");
  assert(!/\bnull\b/i.test(clausula), `clausula no debe contener "null": ${clausula}`);
});

Deno.test("H2-3) buildDocxVars: basura 'null' + flag true → leyenda indeterminada, sin '$' ni 'null'", () => {
  const vars = buildDocxVars(minimalData({ valor_hipoteca_original: "null", valor_hipoteca_es_indeterminada: true }));
  assertEquals(vars.valor_hipoteca_original, undefined);
  assertEquals(vars.valor_hipoteca_es_indeterminada, true);
  // deno-lint-ignore no-explicit-any
  const clausula = String((vars as any).clausula_pago_hipoteca ?? "");
  assertStringIncludes(clausula, "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA");
  assert(!clausula.includes("$"), "no debe contener '$'");
  assert(!/\bnull\b/i.test(clausula), "no debe contener 'null'");
});

Deno.test("H2-4) buildDocxVars: monto real determinado → prosa incluye el monto (no regresión)", () => {
  const vars = buildDocxVars(minimalData({
    valor_hipoteca_original: "CIENTO VEINTE MILLONES DE PESOS ($120.000.000)",
    valor_hipoteca_es_indeterminada: false,
  }));
  assertEquals(vars.valor_hipoteca_original, "CIENTO VEINTE MILLONES DE PESOS ($120.000.000)");
  // deno-lint-ignore no-explicit-any
  const clausula = String((vars as any).clausula_pago_hipoteca ?? "");
  assertStringIncludes(clausula, "120.000.000");
  assert(!/INDETERMINADA/i.test(clausula), "no debe hablar de indeterminada");
});

Deno.test("H2-5) mergeCuantiaIntoExtracted: humano con monto real NO se pisa por indeterminada dedicada", () => {
  const extracted = minimalData({
    valor_hipoteca_original: "OCHENTA MILLONES DE PESOS ($80.000.000)",
    valor_hipoteca_es_indeterminada: false,
  });
  const res = mergeCuantiaIntoExtracted(extracted, {
    valor_hipoteca_original: null,
    valor_hipoteca_es_indeterminada: true,
    motivo_null: "escritura_declara_abierta",
    // deno-lint-ignore no-explicit-any
  } as any);
  assertEquals(res.applied, false);
  assertEquals(extracted.hipoteca_anterior.valor_hipoteca_original, "OCHENTA MILLONES DE PESOS ($80.000.000)");
  assertEquals(extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada, false);
});
