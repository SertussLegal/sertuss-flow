
# Auditoría: 3 errores TS que bloquean el Deno test runner

## 1. Mensajes de error EXACTOS (deno check index.ts)

**Error A — `index.ts:834:39` (TS2345)**
```
Argument of type '{ nombre: string; identificacion: string; identificacion_formateada: string; tipo_id: string; genero: string; }[]'
is not assignable to parameter of type '{ genero?: GeneroGramatical | undefined; }[]'.
  Types of property 'genero' are incompatible.
    Type 'string' is not assignable to type 'GeneroGramatical | undefined'.
  const tokensDeudor = deudoresTokens(deudoresArr);
                                      ~~~~~~~~~~~
```

**Error B — `index.ts:841:30` (TS2345)**
```
Argument of type 'string' is not assignable to parameter of type 'GeneroGramatical | undefined'.
      const t = deudorTokens(d.genero);
                             ~~~~~~~~
```

**Error C — `index.ts:2657:13` (TS2322)**
```
Type '{ ...; genero: string; }[]' is not assignable to type '{ ...; genero?: "" | "M" | "F" | undefined; }[]'.
    Types of property 'genero' are incompatible.
      Type 'string' is not assignable to type '"" | "M" | "F" | undefined'.
            extracted.partes.deudores = deudoresExtraidos.map((d) => ({
            ~~~~~~~~~~~~~~~~~~~~~~~~~
```

## 2. Contexto de código

**Raíz común — `normalizeDeudores` (L758–L783)**
```ts
function normalizeDeudores(partes: CancelacionData["partes"]) {
  ...
  return raw.map((d) => {
    ...
    // L774 — el `|| ""` final ensancha el tipo a `string` porque
    //        `partes.deudor_genero` en CancelacionData es `string`.
    const genero = (d?.genero as "M" | "F" | "" | undefined) || inferGeneroFromNombre(nombre) || "";
    return { nombre, identificacion: ident, identificacion_formateada: formatCC(ident), tipo_id, genero };
  });
}
```
El retorno queda con `genero: string` porque TS ensancha el union al aplicar `||` sobre valores potencialmente `string`. Es un problema de **inferencia**, no de datos: en runtime `genero` es siempre `"M" | "F" | ""`.

- L834: `deudoresTokens(deudoresArr)` recibe `genero: string` en vez de `GeneroGramatical`.
- L841: `deudorTokens(d.genero)` mismo síntoma.
- L2657: la asignación `extracted.partes.deudores = ...` colisiona con el tipo estricto `"" | "M" | "F"` de `CancelacionData.partes.deudores[].genero`.

## 3. Antigüedad (git blame)

| Línea | Commit | Fecha | Autor |
|---|---|---|---|
| L758 (`normalizeDeudores`) | `0abc98bd` | **2026-06-21** | gpt-engineer-app |
| L774 (raíz del ensanchamiento) | `0abc98bd` | **2026-06-21** | gpt-engineer-app |
| L834 | `468cbb1d` | **2026-06-21** | gpt-engineer-app |
| L841 | `468cbb1d` | **2026-06-21** | gpt-engineer-app |
| L2657 | `cffbc68e` | **2026-06-21** | gpt-engineer-app |

**Los 5 commits relevantes son del 21 de junio de 2026** — ~2 semanas antes de la sesión de hoy (2026-07-08). Los cambios de hoy (H2, poder, sanitizeString) NO introdujeron ni movieron ninguna de estas líneas. Deuda técnica genuinamente pre-existente.

## 4. Clasificación

| # | Tipo | Riesgo runtime | Categoría |
|---|---|---|---|
| A (L834) | Falso positivo del checker | **Nulo** — `deudoresTokens` internamente hace `todosF/todosM` con comparación estricta `=== "F" / "M"`. String arbitrario cae al fallback combinado (comportamiento correcto). | Inferencia demasiado amplia. |
| B (L841) | Falso positivo | **Nulo** — `deudorTokens` con string desconocido devuelve el fallback combinado. | Inferencia demasiado amplia. |
| C (L2657) | Falso positivo | **Nulo** — el runtime ya garantiza `"M" \| "F" \| ""` porque `normalizeDeudores` normaliza con `inferGeneroFromNombre` + `\|\| ""`. | Discrepancia entre tipo declarado del schema (`CancelacionData.partes.deudor_genero: string`) y retorno normalizado. |

Ninguno representa un bug real. Los 3 son de la misma familia: `normalizeDeudores` retorna un tipo inferido demasiado amplio (`string`) porque `CancelacionData.partes.deudor_genero` fue declarado `string`.

## 5. Esfuerzo y riesgo del fix

**Fix mínimo — 1 línea, en L783 (el return type del `.map`):**
```ts
return {
  nombre,
  identificacion: ident,
  identificacion_formateada: formatCC(ident),
  tipo_id,
  genero: genero as GeneroGramatical,   // ← narrowing explícito
};
```
Con esto los 3 errores desaparecen en cadena (deudoresArr, d.genero en L841, y el map de L2657 heredan el tipo estrecho).

- **Cambio de código:** 1 línea (o alternativamente tipar el return de `normalizeDeudores` con annotation explícita).
- **Riesgo de negocio:** cero — es puro type-narrowing, no cambia lógica.
- **Requiere tocar lógica:** no.

## 6. Cobertura bloqueada hoy

**20 tests Deno bloqueados en total** (`grep -c "^Deno.test" index_test.ts` → 20). Incluye:
- 7 tests originales de la cirugía v2 (dirección saneada, SNR pad4, cuantía indeterminada, limitaciones concurrentes, etc.)
- 4 tests H2-1..H2-5 (guard `null` en cuantía)
- 4 tests PODER-1..PODER-4 (guard `null` en apoderado — los agregados hoy)
- 5 tests de contrato de schema/prompt (segregación topológica, cardinales, strip)

`_regression_cuantia.ts` y `_shared/__tests__/` no aportan tests Deno adicionales medibles vía este bloqueo.

**Costo real de la deuda:** 20 tests deterministas — que cubren la cirugía v2 completa, ambos parches de "null string" y el contrato de segregación de nomenclatura — nunca corren en el runner Deno hoy. Solo se validan indirectamente por Vitest, que ejerce las funciones puras exportadas pero no consume el módulo completo con imports de Deno.

## Veredicto

Los 3 errores son **reales y pre-existentes desde 2026-06-21**, no fueron introducidos por la sesión de hoy. Los 3 son **falsos positivos de tipo** sin riesgo runtime (misma raíz: inferencia ensanchada por `|| ""` sobre un campo tipado como `string` en el schema). El fix cuesta **1 línea de narrowing** y desbloquea **20 tests Deno**.

## Propuesta de siguiente paso (a aprobar)

Aplicar el fix mínimo de 1 línea en `normalizeDeudores` (L775–L781: tipar el retorno o añadir `as GeneroGramatical` en L780), sin tocar lógica, y correr `deno test` para confirmar que los 20 tests pasan verdes.
