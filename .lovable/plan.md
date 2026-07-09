
# Fix A8 — `montoProsaProtocolo` no reañade M/CTE cuando la IA extrae el monto sin él

## Diagnóstico confirmado

Tres helpers espejo tienen el MISMO bug de idempotencia:

| Archivo | Función | Línea |
|---|---|---|
| `supabase/functions/procesar-cancelacion/index.ts` | `montoProsaProtocolo` | 638–646 |
| `src/lib/legalProse.ts` | `montoProsa` | 164–176 |
| `supabase/functions/process-expediente/legalProse.ts` | `montoProsa` | 140–152 |

**Guard actual (idéntico en los 3):**
```ts
if (typeof raw === "string" && /\(\$[\d.,]+\)\s*$/.test(raw.trim())) return raw.trim();
```

Acepta como "ya formateado" **cualquier** cadena que termine en `($NNN)`, aunque falte `M/CTE`. La IA emite justamente eso (`"... PESOS ($8.858.475)"`), el helper lo devuelve intacto y el docx queda sin M/CTE.

Los 3 deben corregirse en sincronía (regla del proyecto: `legalProse.ts` cliente ↔ backend son espejos).

## Diseño del fix

**Nuevo guard:** exigir que la cadena entrante contenga M/CTE **además** del patrón `($NNN)` para considerarse ya formateada. Si trae `($NNN)` sin M/CTE, extraer el número y re-formatear con `formatMonedaLegal` (que sí añade M/CTE), luego strippear `,00`.

**Variantes de M/CTE aceptadas** (regex tolerante case-insensitive):
- `M/CTE` (canónico)
- `MCTE`, `M.CTE`, `M CTE` (variantes históricas)

Regex: `/\bM\s*[\/.]?\s*CTE\b/i`

**No toca `esIndetLegacy`:** el literal `"HIPOTECA DE CUANTÍA INDETERMINADA"` no termina en `($NNN)`, no entra al guard nuevo ni al viejo. Además, aguas arriba (`index.ts` L938) `esCuantiaIndeterminada` cortocircuita a `undefined` antes de llamar al helper. Comportamiento preservado.

## Diff propuesto (idéntico en los 3 archivos, adaptado a nombre)

### 1) `supabase/functions/procesar-cancelacion/index.ts` (L636-646)

```diff
-// Monto para protocolo: reusa formatMonedaLegal y elimina ",00)" si decimales = 0.
-// Resultado: "TREINTA MILLONES DE PESOS M/CTE ($30.000.000)". Idempotente.
+// Monto para protocolo: reusa formatMonedaLegal y elimina ",00)" si decimales = 0.
+// Resultado: "TREINTA MILLONES DE PESOS M/CTE ($30.000.000)". Idempotente solo
+// cuando la cadena entrante YA contiene M/CTE (requisito registral colombiano).
+// Si trae "... ($NNN)" sin M/CTE, re-normaliza extrayendo el número.
+const _M_CTE_RE = /\bM\s*[\/.]?\s*CTE\b/i;
+const _MONTO_TAIL_RE = /\(\$([\d.,]+)\)\s*$/;
 function montoProsaProtocolo(valor: string | number | undefined | null): string {
   if (valor === null || valor === undefined || valor === "") return "";
   const raw = typeof valor === "number" ? String(valor) : valor;
-  if (typeof raw === "string" && /\(\$[\d.,]+\)\s*$/.test(raw.trim())) return raw.trim();
-  const formateado = formatMonedaLegal(raw);
+  const trimmed = typeof raw === "string" ? raw.trim() : "";
+  const tail = trimmed ? trimmed.match(_MONTO_TAIL_RE) : null;
+  if (tail && _M_CTE_RE.test(trimmed)) {
+    // Ya formateado con M/CTE: idempotente, solo quita ",00" si existe.
+    return trimmed.replace(/,00\)$/, ")");
+  }
+  // Si trae "($NNN)" pero SIN M/CTE, extraer el número y re-formatear.
+  const source = tail ? tail[1] : raw;
+  const formateado = formatMonedaLegal(source);
   if (!formateado) return "";
-  // Escape correcto del paréntesis de cierre.
   return formateado.replace(/,00\)$/, ")");
 }
```

### 2) `src/lib/legalProse.ts` (L164-176) y 3) `supabase/functions/process-expediente/legalProse.ts` (L140-152)

Cambio equivalente, adaptado al nombre `montoProsa` (misma lógica, mismos regex helpers `_M_CTE_RE` / `_MONTO_TAIL_RE` locales al módulo).

## Tests

### Nuevo: `supabase/functions/procesar-cancelacion/montoProsaProtocolo_test.ts`

Fixture con los 5 casos reales auditados + legacy + idempotencia + edge cases.

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { montoProsaProtocolo } from "./index.ts"; // requiere export

Deno.test("A8: monto sin M/CTE se re-normaliza (caso d1d90c54)", () => {
  const input = "OCHO MILLONES OCHOCIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS ($8.858.475)";
  const out = montoProsaProtocolo(input);
  assertEquals(out, "OCHO MILLONES OCHOCIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS M/CTE ($8.858.475)");
});

Deno.test("A8: monto sin M/CTE (caso 4b05d210)", () => {
  const input = "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS ($8.558.475)";
  const out = montoProsaProtocolo(input);
  assertEquals(out, "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS M/CTE ($8.558.475)");
});

Deno.test("A8: monto sin M/CTE (caso d7193993)", () => {
  const input = "CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS ($52.500.000)";
  assertEquals(montoProsaProtocolo(input), "CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS M/CTE ($52.500.000)");
});

Deno.test("A8: monto sin M/CTE (caso 15a90eef)", () => {
  const input = "CIENTO OCHENTA Y CINCO MILLONES DE PESOS ($185.000.000)";
  assertEquals(montoProsaProtocolo(input), "CIENTO OCHENTA Y CINCO MILLONES DE PESOS M/CTE ($185.000.000)");
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
  assertEquals(montoProsaProtocolo(input), "TREINTA MILLONES DE PESOS M/CTE ($30.000.000)");
});

Deno.test("A8: legacy 'HIPOTECA DE CUANTÍA INDETERMINADA' no se formatea (retorna '')", () => {
  // Aguas arriba esCuantiaIndeterminada cortocircuita; si por defensa
  // llegase aquí, no debe intentar parsearlo como monto.
  assertEquals(montoProsaProtocolo("HIPOTECA DE CUANTÍA INDETERMINADA"), "");
});

Deno.test("A8: número crudo se formatea con M/CTE (comportamiento previo)", () => {
  assertEquals(montoProsaProtocolo(30000000), "TREINTA MILLONES DE PESOS M/CTE ($30.000.000)");
});

Deno.test("A8: string vacío/null retorna ''", () => {
  assertEquals(montoProsaProtocolo(""), "");
  assertEquals(montoProsaProtocolo(null), "");
  assertEquals(montoProsaProtocolo(undefined), "");
});
```

**Requisito:** exportar `montoProsaProtocolo` desde `index.ts` (hoy es privada). Alternativa sin cambio de superficie: mover el helper a `_shared/isomorphic/` y re-importarlo desde `index.ts` + test. Preferencia: `export` in-place, mínimo cambio.

### Espejo frontend: `src/lib/legalProse.test.ts` (agregar bloque)

```ts
describe("legalProse — montoProsa (A8 M/CTE guard)", () => {
  it("re-normaliza monto extraído por IA sin M/CTE", () => {
    expect(montoProsa("CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS ($52.500.000)"))
      .toBe("CINCUENTA Y DOS MILLONES QUINIENTOS MIL PESOS M/CTE ($52.500.000)");
  });
  it("respeta MCTE sin barra", () => {
    const s = "TREINTA MILLONES DE PESOS MCTE ($30.000.000)";
    expect(montoProsa(s)).toBe(s);
  });
  it("no toca literales de cuantía indeterminada", () => {
    expect(montoProsa("HIPOTECA DE CUANTÍA INDETERMINADA")).toBe("");
  });
});
```

Los tests existentes de `montoProsa` (L76-95) siguen verdes: input numérico crudo, input ya con M/CTE, y strip de `,00` — el fix solo cambia el camino "trae ($NNN) sin M/CTE".

### Sin espejo backend `process-expediente`

Este helper no tiene test dedicado hoy. Añadir un `Deno.test` mínimo equivalente al bloque de `legalProse.test.ts` en `supabase/functions/process-expediente/legalProse_test.ts` (crear si no existe).

## Verificación de no-regresión

1. **A9 (`"null"` literal → sanitizado):** no toca el path — la sanitización ocurre antes de llegar aquí (en el merge de `data_final`). El fix opera sobre strings válidos con paréntesis. ✅
2. **B4 (extracción semántica de cuantía):** este audit verificó que `valor_hipoteca_original` llega correcto. El fix mejora la salida de render, no la extracción. ✅
3. **`esCuantiaIndeterminada` (skill cuantia-indeterminada-cancelacion):** en L938 `valorHipotecaProtocolo = undefined` cuando el flag es true — el helper ni se llama. Fix preserva ese cortocircuito. ✅
4. **`buildClausulaPagoHipoteca` (L692):** llama a `montoProsaProtocolo(valorRaw)` sólo en la rama NO-indeterminada. Fix mejora la prosa de la cláusula sin cambiar la lógica de rama. ✅
5. **Tests existentes de `montoProsa` frontend (L77-94):** los 4 tests siguen verdes porque cubren números crudos e inputs que ya traen M/CTE. ✅

## Alcance del cambio

**Archivos modificados (3):**
- `supabase/functions/procesar-cancelacion/index.ts` — fix + `export`
- `src/lib/legalProse.ts` — fix
- `supabase/functions/process-expediente/legalProse.ts` — fix

**Archivos nuevos (2):**
- `supabase/functions/procesar-cancelacion/montoProsaProtocolo_test.ts` — 11 tests
- `supabase/functions/process-expediente/legalProse_test.ts` — 3 tests (nuevo archivo o append si existe)

**Archivo con append (1):**
- `src/lib/legalProse.test.ts` — 3 tests nuevos

**Fuera de alcance:**
- No se toca `formatMonedaLegal` (backend ni frontend) — funciona correctamente.
- No se toca el extractor IA — el fix es defensivo en la capa de render, apropiado.
- No se re-generan cancelaciones históricas — solo aplica a nuevas ejecuciones.

## Criterios de aceptación

- [ ] Los 11 tests Deno del helper cancelaciones pasan.
- [ ] Los tests existentes de `legalProse.test.ts` (frontend) siguen verdes + 3 nuevos verdes.
- [ ] Los tests nuevos de `process-expediente/legalProse` verdes.
- [ ] Test suite completo del proyecto verde (sin regresiones).
- [ ] Los tests A5/A9/B4 existentes en `procesar-cancelacion/index_test.ts` (si los hay) siguen verdes.
