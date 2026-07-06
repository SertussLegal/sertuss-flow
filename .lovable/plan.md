# Migración `supabase/shared/` → `supabase/functions/_shared/isomorphic/`

## Diagnóstico verificado

Estado actual (auditoría fresca — sin residuos, tests 84/84 verdes):
- Los 7 archivos productivos viven en `supabase/shared/` (única ubicación).
- Frontend consume vía alias `@shared/*` → funciona en Vite/Vitest/tsgo.
- **Bloqueo real:** las 2 edge functions importan `../../shared/...` que en filesystem existe pero queda fuera de `supabase/functions/`, y el bundler de deploy solo monta ese subárbol. Esto se confirmó empíricamente en el intento previo (Module not found al deployar).

Solución: mover la carpeta a `supabase/functions/_shared/isomorphic/` — el subnombre `isomorphic/` la diferencia claramente de los helpers Deno-only (`aiFetch.ts`, `pdfSha256.ts`, etc.) que conviven en `_shared/`, y facilita que `purity.test.ts` la escanee sin arrastrar a los helpers Deno.

## Cambios (determinista, sin ambigüedad)

### A. Mover 7 archivos (git mv, preserva historia)
```text
supabase/shared/apoderadoClassifier.ts        → supabase/functions/_shared/isomorphic/apoderadoClassifier.ts
supabase/shared/prosaBancos/davivienda.ts     → supabase/functions/_shared/isomorphic/prosaBancos/davivienda.ts
supabase/shared/prosaBancos/index.ts          → ídem
supabase/shared/prosaBancos/legalProse.ts     → ídem
supabase/shared/prosaBancos/mergeOverride.ts  → ídem
supabase/shared/prosaBancos/overrideSchema.ts → ídem
supabase/shared/prosaBancos/types.ts          → ídem
```
Al terminar, `supabase/shared/` queda vacía y se elimina.

### B. Actualizar 4 configs (alias `@shared` sigue apuntando al mismo lugar lógico)
- `vite.config.ts` línea 31: `"./supabase/shared"` → `"./supabase/functions/_shared/isomorphic"`
- `vitest.config.ts`: idem
- `tsconfig.json` `paths`: `"./supabase/shared/*"` → `"./supabase/functions/_shared/isomorphic/*"`
- `tsconfig.app.json`: idem en `paths` **y** reescribir los 7 entries de `include`

### C. Actualizar 2 imports de edge (rutas relativas, se acortan)
- `supabase/functions/procesar-cancelacion/index.ts:19-20`: `../../shared/...` → `../_shared/isomorphic/...`
- `supabase/functions/adaptar-estilo-prosa/index.ts:12`: idem

### D. Actualizar 1 test
- `src/shared/prosaBancos/__contract__/purity.test.ts`: `SHARED_DIR = join(cwd, "supabase/functions/_shared/isomorphic")`

### E. Frontend: **sin cambios**
Los 6 componentes siguen usando `@shared/apoderadoClassifier` y `@shared/prosaBancos/*` — el alias absorbe el rename.

## Verificación

1. `bunx vitest run` → esperar 84/84 verdes (mismos tests, misma pureza).
2. `bunx tsgo --noEmit` → 0 errores (paths tsconfig actualizados).
3. **`deploy_edge_functions(["procesar-cancelacion", "adaptar-estilo-prosa"])`** → esta es la prueba definitiva; en el intento previo esta misma ruta ya deployó sin problema cuando los archivos eran shims, ahora debe deployar con el código real.
4. `curl` `regen: true` sobre cancelación `290fd66a-…` → confirmar runtime OK.

Si el paso 3 falla, se detiene y se reporta el error crudo (no se improvisa).

## Riesgos y reversión

- **Riesgo bajo.** Es un rename + 4 configs + 2 imports edge. El único vector de falla real (deploy) ya se probó exitosamente con esta misma ubicación en la iteración de esta mañana.
- **Reversión:** `git` revierte el rename atómicamente. Sin migraciones, sin datos, sin schema.

## Fuera de alcance

- No se toca `_shared/aiFetch.ts` ni otros helpers Deno-only.
- No se toca ningún componente frontend.
- No se toca `deno.json` (ya tiene `zod` correcto).
- No se crea ningún re-export ni shim.
