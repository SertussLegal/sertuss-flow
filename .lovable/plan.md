
# Opción A revisada — fuente en `supabase/functions/_shared/isomorphic/`

Confirmado empíricamente que el bundler de edge SOLO monta `supabase/functions/`. Por tanto la fuente única DEBE vivir ahí. Se corrige la fricción de tipado que hundió el primer intento con una subcarpeta dedicada y un `include` quirúrgico.

## 1. Ubicación recomendada: subcarpeta `isomorphic/`

Recomendación: **crear `supabase/functions/_shared/isomorphic/`** y meter allí los 7 archivos, en vez de mezclarlos con los helpers Deno-only que ya viven en `_shared/` (aiFetch.ts, pdfSha256.ts, poderBancoSchemaVersion.ts que usa `Deno.env`, etc.).

Ventajas:

- Deja claro por convención qué archivos son "seguros" para consumir desde el navegador (nada de `Deno.*`, `npm:`, `https://…`, ni tipos DB).
- El `include` del tsconfig del navegador puede apuntar a la subcarpeta entera en vez de listar archivos uno por uno (mantenible cuando se añadan bancos).
- El test `purity.test.ts` (que hoy escanea archivo por archivo) puede apuntar al directorio entero sin tocar su lógica.
- El deploy edge sigue viendo la subcarpeta porque está debajo del árbol montado.

Estructura final:

```text
supabase/functions/_shared/
  aiFetch.ts                   ← Deno-only (queda igual)
  pdfSha256.ts                 ← Deno-only (queda igual)
  poderBancoSchemaVersion.ts   ← Deno-only (queda igual)
  ...
  isomorphic/
    apoderadoClassifier.ts     ← fuente única
    prosaBancos/
      index.ts
      davivienda.ts
      types.ts
      overrideSchema.ts
      mergeOverride.ts
      legalProse.ts
```

## 2. Re-exports desde `src/shared/`

`src/shared/` se conserva como fachada del navegador para no romper el patrón mental de "código compartido vive en src/shared". Pero es solo un re-export delgado, no la fuente:

```ts
// src/shared/apoderadoClassifier.ts
export * from "@shared/apoderadoClassifier";
```

```ts
// src/shared/prosaBancos/index.ts
export * from "@shared/prosaBancos";
```

Igual para `davivienda.ts`, `types.ts`, `overrideSchema.ts`, `mergeOverride.ts`, `legalProse.ts` — cada uno un `export * from "@shared/prosaBancos/<file>"`.

`src/lib/apoderadoClassifier.ts` **NO se restaura**. Los 2 call-sites que lo usaban ya se migraron al import canónico y no hay razón para reintroducir un shim doble. Si algún día aparece código legacy que lo importe, resolveremos ahí.

Alternativa considerada y descartada: exportar directo desde `@shared/…` en todos los call-sites y borrar `src/shared/` por completo. Descartada porque los tests `__contract__/` viven en `src/shared/prosaBancos/__contract__/` y varios imports frontend siguen escribiendo `@/shared/…` en código no listado. Mantener la fachada evita una migración masiva a cambio de 7 archivos de 1 línea.

## 3. LA CORRECCIÓN CLAVE — `tsconfig.app.json` sin mezclar globals

El problema histórico: al incluir `supabase/functions/_shared` completo, tsc levantaba errores por globals `Deno`, imports `https://deno.land/…` y `npm:` en archivos vecinos.

Solución: **include quirúrgico por subcarpeta isomórfica**, sin tsconfig separado ni override de `types`. La subcarpeta `isomorphic/` está por definición limpia de todo lo Deno-only (el test `purity.test.ts` lo garantiza automáticamente), así que su include no contamina el proyecto del navegador.

`tsconfig.app.json` — sección relevante:

```json
{
  "compilerOptions": {
    ...
    "paths": {
      "@/*": ["./src/*"],
      "@shared/*": ["./supabase/functions/_shared/isomorphic/*"]
    }
    ...
  },
  "include": [
    "src",
    "supabase/functions/_shared/isomorphic"
  ]
}
```

`tsconfig.json` (root) — mismo `paths` para editor/tsserver:

```json
"paths": {
  "@/*": ["./src/*"],
  "@shared/*": ["./supabase/functions/_shared/isomorphic/*"]
}
```

`vite.config.ts` — alias:

```ts
alias: {
  "@": path.resolve(__dirname, "./src"),
  "@shared": path.resolve(__dirname, "./supabase/functions/_shared/isomorphic"),
}
```

`vitest.config.ts` — mismo alias.

**No hace falta** tsconfig separado, ni `types` override, ni excluir archivos individuales. La disciplina la impone la carpeta + `purity.test.ts` (que ya escanea y bloquea `Deno.env`, `npm:`, `https:`, `react`, `node:fs`, tipos DB Supabase). Ningún archivo Deno-only vive dentro de `isomorphic/`, y el test falla al PR si alguien intenta meter uno.

Advertencia sobre `zod`: `overrideSchema.ts` importa `zod` bare. En el navegador Vite lo resuelve al paquete npm (ya en `package.json`). En Deno edge se resuelve vía `deno.json` per-function con `"zod": "npm:zod@3.25.76"` — los archivos `supabase/functions/procesar-cancelacion/deno.json` y `supabase/functions/adaptar-estilo-prosa/deno.json` YA existen del turno pasado y se conservan intactos. No hay que recrearlos.

## 4. Call-sites finales

**Frontend (13) — imports `@/shared/…` y `@/lib/apoderadoClassifier` → `@shared/…`:**

| Archivo | Import final |
|---|---|
| `src/lib/buildProsaContext.ts` | `@shared/prosaBancos/types` |
| `src/pages/CancelacionValidar.tsx` (L33-34) | `@shared/prosaBancos` + `@shared/prosaBancos/types` |
| `src/components/cancelaciones/PoderBannersV5.tsx` (L29) | `@shared/apoderadoClassifier` |
| `src/components/cancelaciones/prosa/ProsaLiveRenderer.tsx` (L9-10) | `@shared/prosaBancos` + `@shared/prosaBancos/types` |
| `src/components/cancelaciones/prosa/ProsaApoderadoPreviewCard.tsx` (L12-13) | idem |
| `src/components/cancelaciones/prosa/ProsaApoderadoModal.tsx` (L27-28) | `@shared/prosaBancos/overrideSchema` + `@shared/prosaBancos/types` |

Ya están así desde el turno anterior — solo cambia lo que apunta el alias, no los strings de import. Cero ediciones frontend.

**Tests (5) — ya migrados a `@shared/…`, sin cambios:**

- `src/shared/apoderadoClassifier.test.ts` → `@shared/apoderadoClassifier`
- `src/shared/prosaBancos/__contract__/parity.test.ts` → `@shared/prosaBancos/{davivienda,mergeOverride,types}`
- `src/shared/prosaBancos/__contract__/prosaContract.test.ts` → `@shared/prosaBancos/{davivienda,types}`
- `src/shared/prosaBancos/__contract__/overrideSchema.test.ts` → `@shared/prosaBancos/overrideSchema`
- `src/shared/prosaBancos/__contract__/purity.test.ts` → `SHARED_DIR = join(process.cwd(), "supabase/functions/_shared/isomorphic/prosaBancos")` (**única línea nueva** que hay que cambiar respecto al estado actual)

**Edge functions (2) — imports actuales `../../shared/…` → `../_shared/isomorphic/…`:**

| Archivo | Import final |
|---|---|
| `supabase/functions/procesar-cancelacion/index.ts` L19 | `../_shared/isomorphic/apoderadoClassifier.ts` |
| `supabase/functions/procesar-cancelacion/index.ts` L20 | `../_shared/isomorphic/prosaBancos/index.ts` |
| `supabase/functions/adaptar-estilo-prosa/index.ts` L12 | `../_shared/isomorphic/prosaBancos/index.ts` |

**Fachadas nuevas en `src/shared/` (7 archivos de 1 línea):**

`src/shared/apoderadoClassifier.ts`, `src/shared/prosaBancos/{index,davivienda,types,overrideSchema,mergeOverride,legalProse}.ts` — cada uno con `export * from "@shared/…"` correspondiente.

## 5. Reversión del intento fallido (estado actual limpio)

Estado actual del repo tras el turno anterior:
- Archivos productivos viven en `supabase/shared/…` (ubicación no viable para deploy).
- Alias `@shared` en 4 configs apunta a `./supabase/shared`.
- Include en `tsconfig.app.json` lista 7 rutas `supabase/shared/…` archivo-por-archivo.
- `src/shared/apoderadoClassifier.ts` y los 6 de `src/shared/prosaBancos/{index,davivienda,types,overrideSchema,mergeOverride,legalProse}.ts` **ya no existen** (fueron movidos al primer paso del turno anterior).
- Tests `__contract__/` referencian `@shared/…` (bien) y `purity.test.ts` escanea `supabase/shared/prosaBancos` (hay que cambiarlo).
- `deno.json` en las dos edge functions con `zod → npm:zod@3.25.76` (bien, se conserva).

Secuencia atómica (un solo commit) para revertir + aplicar el nuevo diseño:

1. `mkdir -p supabase/functions/_shared/isomorphic/prosaBancos`
2. `mv supabase/shared/apoderadoClassifier.ts supabase/functions/_shared/isomorphic/apoderadoClassifier.ts`
3. `mv supabase/shared/prosaBancos/*.ts supabase/functions/_shared/isomorphic/prosaBancos/`
4. `rmdir supabase/shared/prosaBancos supabase/shared` (verificar vacío antes)
5. Crear las 7 fachadas en `src/shared/` con `export * from "@shared/…"`.
6. Editar los 4 configs (alias `@shared` → `./supabase/functions/_shared/isomorphic`).
7. Simplificar `tsconfig.app.json` include: reemplazar las 7 líneas archivo-por-archivo por `"supabase/functions/_shared/isomorphic"`.
8. Actualizar 2 edge imports (`../../shared/` → `../_shared/isomorphic/`).
9. Actualizar `purity.test.ts` (SHARED_DIR).

Cero riesgo en runtime durante la reversión — la versión productiva desplegada en `_shared/` desde el turno anterior sigue sirviendo hasta que el paso 6 de verificación (deploy real) haga swap.

## 6. Verificación

Orden estricto, detenerse al primer fallo:

1. `bunx vitest run` — esperado: 84/84 verdes. La `purity.test.ts` ahora escanea la nueva ruta, si algún archivo isomórfico se coló con imports prohibidos, se detecta aquí.
2. `bunx tsgo --noEmit` — esperado: cero errores. Prueba que el include quirúrgico no arrastra globals Deno.
3. `deploy_edge_functions(["procesar-cancelacion", "adaptar-estilo-prosa"])` — **prueba definitiva**. Con la fuente real dentro del árbol montado, el bundler debe resolver `../_shared/isomorphic/…` sin drama. Si falla aquí, detenerse y reportar el mensaje exacto sin tocar nada más.
4. `regen: true` sobre `290fd66a-c87c-4c3e-a344-e6bc47564966` — confirma que el runtime nuevo procesa cancelaciones sin regresión. HTTP 200 esperado, sin cobro de créditos, `error_message` NULL, URLs actualizadas.
5. `system_events` últimas 24 h para descartar nuevos errores en `adaptar-estilo-prosa`.

Si (3) falla por alguna razón imprevista (import_map no aplicado, subcarpeta rechazada, etc.), el fallback ordenado sería mover la fuente un nivel arriba a `supabase/functions/_shared/` plano (sin subcarpeta), que YA se probó verde en el turno anterior — pero es menos limpio conceptualmente. No lo aplicaría automáticamente, esperaría tu OK.

## Preguntas abiertas antes de ejecutar

1. ¿Confirmas la subcarpeta `isomorphic/` o prefieres los 7 archivos planos en `_shared/` (menos ordenado pero ya probado verde)?
2. ¿OK con mantener la fachada `src/shared/` (7 re-exports de 1 línea) o prefieres eliminarla y migrar los call-sites frontend a `@shared/…` en el mismo commit (ya son 6 archivos, no es más trabajo)?
3. Los tests `__contract__/` — ¿se quedan definitivamente en `src/shared/prosaBancos/__contract__/` como se decidió antes, o los mueves también al lado de la fuente en `supabase/functions/_shared/isomorphic/prosaBancos/__contract__/` para que la subcarpeta sea totalmente autocontenida (incluidos sus tests)?
