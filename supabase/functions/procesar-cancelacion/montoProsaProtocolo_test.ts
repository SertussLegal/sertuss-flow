import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { montoProsaProtocolo } from "./index.ts";

Deno.test("A8: monto sin M/CTE se re-normaliza (caso d1d90c54)", () => {
  const input = "OCHO MILLONES OCHOCIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS ($8.858.475)";
  const out = montoProsaProtocolo(input);
  assertEquals(
    out,
    "OCHO MILLONES OCHOCIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS M/CTE ($8.858.475)",
  );
});

Deno.test("A8: monto sin M/CTE (caso 4b05d210)", () => {
  const input = "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS ($8.558.475)";
  const out = montoProsaProtocolo(input);
  assertEquals(
    out,
    "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS M/CTE ($8.558.475)",
  );
});

Deno.test("A8: monto sin M/CTE (caso d7193993)", () => {
  const input = "CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS ($52.500.000)";
  assertEquals(
    montoProsaProtocolo(input),
    "CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS M/CTE ($52.500.000)",
  );
});

Deno.test("A8: monto sin M/CTE (caso 15a90eef)", () => {
  const input = "CIENTO OCHENTA Y CINCO MILLONES DE PESOS ($185.000.000)";
  assertEquals(
    montoProsaProtocolo(input),
    "CIENTO OCHENTA Y CINCO MILLONES DE PESOS M/CTE ($185.000.000)",
  );
});

Deno.test("A8: monto YA con M/CTE no se duplica (caso 5022544d)", () => {
  const input = "CIENTO OCHENTA Y CINCO MILLONES DE PESOS M/CTE ($185.000.000)";
  assertEquals(montoProsaProtocolo(input), input);
});

Deno.test("A8: idempotencia — mismo output al re-pasar por el helper", () => {
  const input = "CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS ($52.500.000)";
  const once = montoProsaProtocolo(input);
  const twice = montoProsaProtocolo(once);
  assertEquals(once, twice);
});

Deno.test("A8: variante MCTE sin barra se respeta como ya formateado", () => {
  const input = "TREINTA MILLONES DE PESOS MCTE ($30.000.000)";
  assertEquals(montoProsaProtocolo(input), input);
});

Deno.test("A8: strip ,00 cuando trae M/CTE y decimales cero", () => {
  const input = "TREINTA MILLONES DE PESOS M/CTE ($30.000.000,00)";
  assertEquals(
    montoProsaProtocolo(input),
    "TREINTA MILLONES DE PESOS M/CTE ($30.000.000)",
  );
});

Deno.test("A8: legacy 'HIPOTECA DE CUANTÍA INDETERMINADA' no se formatea (retorna '')", () => {
  assertEquals(montoProsaProtocolo("HIPOTECA DE CUANTÍA INDETERMINADA"), "");
});

Deno.test("A8: número crudo se formatea con M/CTE (comportamiento previo)", () => {
  assertEquals(
    montoProsaProtocolo(30000000),
    "TREINTA MILLONES DE PESOS M/CTE ($30.000.000)",
  );
});

Deno.test("A8: string vacío/null retorna ''", () => {
  assertEquals(montoProsaProtocolo(""), "");
  assertEquals(montoProsaProtocolo(null), "");
  assertEquals(montoProsaProtocolo(undefined), "");
});
