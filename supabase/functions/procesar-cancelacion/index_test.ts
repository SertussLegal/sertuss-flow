// Tests deterministas para la cirugía v2 (Cancelaciones Davivienda).
// Caso real: Escritura 3866, Notaría 72, año 2011, Anotaciones 0007 y 0008.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDireccionCompletaSaneada,
  buildClausulaPagoHipoteca,
  buildClausulaLimitacionesSubsisten,
  pad4,
} from "./index.ts";

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
