# Fix A11 — `certificadoTradicion/prompt.ts` contradice al tool schema con la palabra "GUION"

## 1. Texto actual (4 líneas problemáticas)

Archivo: `supabase/functions/scan-document/core/certificadoTradicion/prompt.ts`

- **L22** (regla b, formato de placa):
  ```
  - Placa: literal "NÚMERO" + primer número en letras + "GUION" + segundo número en letras, y cerrar con "(N SUR? No. N-N)".
  ```
- **L26** (ejemplo blindaje alfanumérico):
  ```
  - "CALLE 62A # 53B-21" → "CALLE SESENTA Y DOS A NÚMERO CINCUENTA Y TRES B GUION VEINTIUNO (62A No. 53B-21)".
  ```
- **L27** (ejemplo blindaje alfanumérico):
  ```
  - "KR 13 BIS # 85-32" → "CARRERA TRECE BIS NÚMERO OCHENTA Y CINCO GUION TREINTA Y DOS (13 BIS No. 85-32)".
  ```
- **L40** (ejemplo canónico Bogotá):
  ```
  "CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA GUION OCHENTA Y CUATRO (59 SUR No. 60-84) TORRE CINCO (5) APARTAMENTO QUINIENTOS UNO (501)"
  ```

Contradicen a `tool.ts:32` (regla oficial): *"SEPARADOR DE PLACA: se conserva como el SÍMBOLO '-' (guion ASCII rodeado de espacios), NUNCA se verbaliza como la palabra 'GUION'"*. También contradicen a `procesar-cancelacion/index.ts:327,330,333` que ya usan el símbolo "-".

## 2. Diff propuesto

Un solo archivo modificado: `supabase/functions/scan-document/core/certificadoTradicion/prompt.ts`

```diff
@@ L22
-   - Placa: literal "NÚMERO" + primer número en letras + "GUION" + segundo número en letras, y cerrar con "(N SUR? No. N-N)".
+   - Placa: literal "NÚMERO" + primer número en letras + " - " (SÍMBOLO GUION ASCII rodeado de espacios, NUNCA la palabra "GUION") + segundo número en letras, y cerrar con "(N SUR? No. N-N)".
@@ L26-27
-   - "CALLE 62A # 53B-21" → "CALLE SESENTA Y DOS A NÚMERO CINCUENTA Y TRES B GUION VEINTIUNO (62A No. 53B-21)".
-   - "KR 13 BIS # 85-32" → "CARRERA TRECE BIS NÚMERO OCHENTA Y CINCO GUION TREINTA Y DOS (13 BIS No. 85-32)".
+   - "CALLE 62A # 53B-21" → "CALLE SESENTA Y DOS A NÚMERO CINCUENTA Y TRES B - VEINTIUNO (62A No. 53B-21)".
+   - "KR 13 BIS # 85-32" → "CARRERA TRECE BIS NÚMERO OCHENTA Y CINCO - TREINTA Y DOS (13 BIS No. 85-32)".
@@ L28 (misma zona, ya prohíbe "ALFA/BETA/…"; se refuerza)
-   PROHIBIDO inventar palabras como "ALFA", "BETA", "GAMMA" o "DOBLE": la letra/sufijo se transcribe literal en mayúscula.
+   PROHIBIDO inventar palabras como "ALFA", "BETA", "GAMMA", "DOBLE" o "GUION": la letra/sufijo se transcribe literal en mayúscula y el separador de placa es el símbolo "-".
@@ L40
-    "CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA GUION OCHENTA Y CUATRO (59 SUR No. 60-84) TORRE CINCO (5) APARTAMENTO QUINIENTOS UNO (501)"
+    "CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA - OCHENTA Y CUATRO (59 SUR No. 60-84) TORRE CINCO (5) APARTAMENTO QUINIENTOS UNO (501)"
```

La edición extra en L28 replica el patrón ya presente en `procesar-cancelacion/index.ts:333` — hace explícito que "GUION" también es palabra prohibida, no solo omisión de ejemplo. Es 1 línea adicional dentro del mismo módulo, mismo alcance.

## 3. Riesgo de tests existentes

Búsqueda global (`rg "GUION|certificadoTradicionPrompt"` en `supabase/` y `src/`, filtrando archivos test):

- **No existe ningún test de `certificadoTradicion`** (prompt, tool o handler). Cero cobertura previa.
- Único match: `supabase/functions/procesar-cancelacion/index_test.ts:134` — `assertStringIncludes(SRC, "GUION")` donde `SRC = readTextFile("./index.ts")` de `procesar-cancelacion`, **no** del prompt de scan-document. Ese `index.ts` sigue conteniendo la palabra "GUION" en frases prohibitivas ("NUNCA la palabra 'GUION'", "PROHIBIDO … 'GUION'"). El test sigue verde. **Sin impacto.**

Conclusión: **cero regresiones esperadas** por la edición del prompt.

## 4. Test de regresión nuevo

Archivo nuevo: `supabase/functions/scan-document/core/certificadoTradicion/prompt_test.ts`

Objetivo: garantizar que ningún futuro cambio reintroduzca "GUION" como instrucción, y que el símbolo "-" siga siendo el separador oficial.

```ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { certificadoTradicionPrompt } from "./prompt.ts";

Deno.test("A11: prompt NO contiene la palabra 'GUION' como instrucción de formato", () => {
  // Solo se permite la palabra en contextos prohibitivos explícitos
  // ("NUNCA la palabra 'GUION'", "PROHIBIDO … 'GUION'"). Cualquier otro
  // uso indica regresión al ejemplo antiguo.
  const matches = certificadoTradicionPrompt.match(/GUION/g) ?? [];
  const contextos = certificadoTradicionPrompt.split(/\n/).filter((l) => l.includes("GUION"));
  for (const linea of contextos) {
    const esProhibitivo = /NUNCA.*['"]GUION['"]|PROHIBIDO.*['"]GUION['"]/.test(linea);
    if (!esProhibitivo) {
      throw new Error(`Regresión A11: 'GUION' aparece como instrucción, no como prohibición → ${linea}`);
    }
  }
  // Al menos una ocurrencia prohibitiva debe existir (documenta la regla).
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
```

## 5. Alcance del cambio

**Modificado (1):**
- `supabase/functions/scan-document/core/certificadoTradicion/prompt.ts` — 4 líneas de ejemplo + 1 refuerzo en L28.

**Nuevo (1):**
- `supabase/functions/scan-document/core/certificadoTradicion/prompt_test.ts` — 3 tests Deno.

**No se toca:** `tool.ts`, `handler.ts`, `index.ts` de scan-document, ni `procesar-cancelacion/index.ts` (ya correcto).

## 6. Criterios de aceptación

- [ ] Los 4 ejemplos del prompt usan " - " en vez de " GUION ".
- [ ] La palabra "GUION" solo aparece en frases prohibitivas.
- [ ] `deno test supabase/functions/scan-document/core/certificadoTradicion/prompt_test.ts` verde.
- [ ] Suite completo (Deno + Vitest) sin regresiones — en particular `procesar-cancelacion/index_test.ts:134` sigue verde.

## 7. Fuera de alcance

- No re-generar certificados históricos ya extraídos.
- No tocar la lógica de red de seguridad en `procesar-cancelacion/index.ts:901` (ya normaliza si el modelo emite "GUION" pese al prompt).
- No modificar prompts de otros extractores (poderBanco, predial, cartaCredito) — este audit es específico a certificadoTradicion.
