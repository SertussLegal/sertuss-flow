import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { certificadoTradicionPrompt } from "./prompt.ts";

Deno.test("A11: prompt NO contiene la palabra 'GUION' como instrucción de formato", () => {
  const matches = certificadoTradicionPrompt.match(/GUION/g) ?? [];
  const contextos = certificadoTradicionPrompt.split(/\n/).filter((l) => l.includes("GUION"));
  for (const linea of contextos) {
    const esProhibitivo = /NUNCA.*['"]GUION['"]|PROHIBIDO.*['"]GUION['"]/.test(linea);
    if (!esProhibitivo) {
      throw new Error(`Regresión A11: 'GUION' aparece como instrucción, no como prohibición → ${linea}`);
    }
  }
  if (matches.length === 0) {
    throw new Error("Se espera que la prohibición explícita mencione 'GUION' al menos una vez.");
  }
});

Deno.test("A11: prompt usa el símbolo '-' como separador de placa en los ejemplos", () => {
  assertStringIncludes(
    certificadoTradicionPrompt,
    "CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA - OCHENTA Y CUATRO",
  );
});

Deno.test("A11: prompt sigue alineado con tool.ts (regla de separador)", async () => {
  const toolSrc = await Deno.readTextFile(new URL("./tool.ts", import.meta.url));
  assertStringIncludes(toolSrc, "NUNCA se verbaliza como la palabra 'GUION'");
});
