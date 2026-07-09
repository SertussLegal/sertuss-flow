import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { montoProsa } from "./legalProse.ts";

Deno.test("A8: re-normaliza monto extraído por IA sin M/CTE", () => {
  assertEquals(
    montoProsa("CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS ($52.500.000)"),
    "CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS M/CTE ($52.500.000)",
  );
});

Deno.test("A8: respeta MCTE sin barra", () => {
  const s = "TREINTA MILLONES DE PESOS MCTE ($30.000.000)";
  assertEquals(montoProsa(s), s);
});

Deno.test("A8: no toca literales de cuantía indeterminada", () => {
  assertEquals(montoProsa("HIPOTECA DE CUANTÍA INDETERMINADA"), "");
});
