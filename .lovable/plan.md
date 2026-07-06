
# Verificación funcional: `src/shared/prosaBancos/legalProse.ts` vs `src/lib/legalProse.ts`

## 1. Archivos analizados

Los 3 archivos ya están leídos en su totalidad (ver contexto). Resumen de exports:

| Archivo | Exports |
|---|---|
| `src/shared/prosaBancos/legalProse.ts` (isomórfico, 97 líneas) | `numeroConLetras`, `fechaProsa` |
| `src/lib/legalProse.ts` (Vite, 177 líneas) | `numeroConLetras`, `fechaProsa`, `escrituraProsa`, `montoProsa`, `EscrituraInput` |
| `supabase/functions/process-expediente/legalProse.ts` (Deno, 153 líneas) | `numeroConLetras`, `fechaProsa`, `escrituraProsa`, `montoProsa`, `EscrituraInput` |

## 2. Paridad función por función (shared vs lib)

### `numeroConLetras(n, gender)`
- **Mismas firmas y defaults** (`gender = "masculine"`).
- Misma tabla `FEMENINOS_ORDINALES_1_10` (idéntica, con tildes).
- Misma `masculinoAFemenino` (3 regex idénticos, en el mismo orden).
- Misma `ALREADY_FORMATTED_RE` para idempotencia.
- Misma guardia `!Number.isFinite(num) || num <= 0 → ""`.
- Misma rama femenino 1..10 → tabla ordinal.
- Diferencia estructural, NO de comportamiento: `src/lib` importa `numberToWords` desde `@/lib/legalFormatters`; `src/shared` incluye una copia inline de `numberToWordsLegal` + `UNITS/TEENS/TENS/HUNDREDS/VEINTIS/convertGroup`. Comparando byte a byte esos arrays y funciones con los de `legalFormatters.ts`: son **idénticos** (mismos strings con tildes, misma lógica `convertGroup`, mismos `groups` con `mil millones/millón/mil`, mismo `q === 1 → " mil"` sin duplicar `un`).
- **Veredicto**: 100% equivalente en salida para todo input.

### `fechaProsa(fecha)`
- Misma detección `ymd`/`dmy` con `/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/` y el DMY.
- Misma guardia `mes<1||mes>12||dia<1||dia>31 → ""`.
- Mismo arreglo `MESES` (12 meses, minúsculas, sin tildes).
- Misma composición final.
- **Veredicto**: 100% equivalente. Nota: `src/lib` no valida `isNaN`, pero como `parseInt` sobre `\d+` matchado nunca produce NaN, es equivalente.

### Funciones no presentes en `src/shared`
`escrituraProsa` y `montoProsa` **no existen** en el archivo isomórfico. Irrelevante para el consumidor real (`davivienda.ts` no las llama).

## 3. Call-sites reales en `davivienda.ts`

Únicos usos (grep confirmado):
```
numeroConLetras(c.numero!, "masculine")
numeroConLetras(ctx.apoderado.escritura_poder_num!, "masculine")
numeroConLetras(ctx.apoderado.escritura_poder_notaria_num!, "feminine")
numeroConLetras(ctx.instrumento.escritura_num!, "masculine")
numeroConLetras(ctx.instrumento.notaria_numero!, "feminine")
numeroConLetras(c.reforma_acta_numero!, "masculine")
fechaProsa(fecha!)   // dentro de fechaOTexto()
```
Inputs reales: strings de OCR con dígitos (números de escritura, actas, notarías, fechas ISO/DMY). Todos caen dentro del comportamiento cubierto y equivalente entre ambas versiones. No hay casos extremos (negativos, ceros, no-numéricos, ya-formateados) presentes en el flujo real.

## 4. ⚠️ Bloqueador arquitectónico: no se puede eliminar

`davivienda.ts` es **re-exportado** desde el edge function Deno:

```
supabase/functions/_shared/prosaBancos/davivienda.ts:
  export * from "../../../../src/shared/prosaBancos/davivienda.ts";
```

Ese archivo Deno consume `davivienda.ts` → que a su vez importa `./legalProse.ts`. Si cambiamos el import a `@/lib/legalProse`:

1. `@/...` es un **alias de Vite**, no resuelve en Deno.
2. Incluso con path relativo `../../lib/legalProse`, `src/lib/legalProse.ts` internamente hace `import { formatMonedaLegal, numberToWords } from "@/lib/legalFormatters"` — otro alias no resoluble en Deno.

El propósito **explícito** de `src/shared/prosaBancos/legalProse.ts` está documentado en su cabecera: *"ISOMÓRFICO (Deno + Vite). Este archivo NO importa nada externo — es 100 % TS puro."* Existe precisamente para romper la cadena de alias `@/`.

Eliminarlo (o repuntar davivienda.ts a `src/lib/legalProse`) **rompería el edge function `procesar-cancelacion`** al desplegarse en Deno — mismo síntoma que ocurrió en el intento anterior en preview local.

## 5. Recomendación final

**NO eliminar** `src/shared/prosaBancos/legalProse.ts`.

Aunque las dos versiones son 100% equivalentes en comportamiento para todos los inputs reales y sintéticos que pueda producir el flujo, el duplicado **no es accidental**: es el mecanismo que hace `davivienda.ts` isomórfico (Vite + Deno). Reclasificar como código intencional, no como duda de limpieza.

Ambas versiones son correctas — ninguna necesita corregirse.

## 6. Salvaguarda propuesta: test de paridad (a implementar en paso separado si se aprueba)

Ubicación: `src/shared/prosaBancos/__contract__/legalProse.parity.test.ts`

Objetivo: garantizar que si alguien modifica una copia, la otra falla el CI.

Casos:
```
numeroConLetras — inputs: 0, -1, 1, 5, 10, 11, 20, 21, 22, 30, 99, 100, 101,
  199, 200, 999, 1000, 1001, 1971, 3892, 1_000_000, 999_999_999,
  "0035", "  ", "abc", "treinta y cinco (35)" (idempotencia),
  cada uno con gender="masculine" y "feminine"
fechaProsa — inputs: "", "2024-01-01", "1971-10-16", "29-01-1971",
  "29/01/1971", "1971/10/16", "31-02-2024" (día inválido? no, 31 pasa el guard),
  "00-01-2024", "01-13-2024", "abc", "2024-1-1", "1-1-2024"
```
Assert: `sharedFn(input) === libFn(input)` para cada caso. Falla del test = drift entre copias.

Sin cambios de código en esta respuesta.
