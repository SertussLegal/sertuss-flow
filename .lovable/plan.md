# Verificación previa al fix de re-exports cross-src

Solo lectura. Ningún archivo modificado.

---

## VERIFICACIÓN 1 — Inventario completo de imports que salen de `supabase/functions/`

**Metodología**: `rg` sobre `supabase/functions/` buscando (a) imports/exports con 3+ niveles de `../` y (b) cualquier referencia a `/src/`.

### Resultado: solo los 4 archivos ya conocidos. Cero adicionales.

| # | Archivo | Import cross-src | Función que lo consume | ¿Bloquea redeploy? |
|---|---|---|---|---|
| 1 | `supabase/functions/_shared/apoderadoClassifier.ts:5` | `export * from "../../../src/shared/apoderadoClassifier.ts"` | `procesar-cancelacion` (import directo) | ✅ Sí |
| 2 | `supabase/functions/_shared/prosaBancos/index.ts:5` | `export * from "../../../../src/shared/prosaBancos/index.ts"` | `procesar-cancelacion`, `adaptar-estilo-prosa` | ✅ Sí |
| 3 | `supabase/functions/_shared/prosaBancos/davivienda.ts:5` | `export * from "../../../../src/shared/prosaBancos/davivienda.ts"` | Transitivo vía `prosaBancos/index.ts` | ✅ Sí (transitivo) |
| 4 | `supabase/functions/_shared/prosaBancos/types.ts:5` | `export * from "../../../../src/shared/prosaBancos/types.ts"` | Transitivo vía `prosaBancos/index.ts` | ✅ Sí (transitivo) |

### Único otro hit con `../../../` que NO cruza a `src/`

- `supabase/functions/_shared/prosaBancos/__contract__/contract_test.ts:11` → `import { poderBancoTool } from "../../../scan-document/core/poderBanco/tool.ts"`
  - **No es riesgo**: el destino sigue dentro de `supabase/functions/` (llega a `scan-document/core/poderBanco/tool.ts`, no a `src/`).
  - Además es un archivo `_test.ts` — Deno test, nunca se despliega como runtime de edge function.

### Confirmación firme

**No existe ningún quinto archivo con re-export/import cross-src.** El radio de impacto real del fix (invertir dirección de re-exports) son exactamente esos 4 archivos en `supabase/functions/_shared/` + sus 4 contrapartes fuente en `src/shared/`.

---

## VERIFICACIÓN 2 — ¿Vite puede resolver imports que "suben" fuera de `src/`?

### Evidencia de configuración actual

- `vite.config.ts`: `resolve.alias` define solo `@ → ./src`. No hay `fs.allow` restringido, no hay `fs.strict: true`. El `root` implícito es la raíz del repo (donde vive `vite.config.ts`), no `src/`.
- `tsconfig.app.json`: `"include": ["src"]` y `paths: { "@/*": ["./src/*"] }`. Los tests corren con Vitest usando el mismo alias.
- `tsconfig.json` (raíz): `allowJs: true`, sin restricciones adicionales.

### Respuesta técnica

**Sí, Vite puede resolver rutas relativas que salen de `src/` sin problema.** Por defecto:

1. **`server.fs.allow` de Vite** solo restringe qué archivos puede *servir* el dev server (por seguridad SSRF), y por defecto permite todo el workspace root — es decir, la raíz del repo. Un import desde `src/shared/foo.ts` hacia `../../supabase/functions/_shared/foo.ts` cae dentro del workspace y **se resuelve limpio**.
2. **El bundler de producción** (`vite build`) no tiene ningún límite de "no salir de `src/`". Sigue los imports estáticos allá donde apunten.
3. **Vitest** hereda esa misma resolución.

### Pero hay una consideración práctica NO trivial

**El TypeScript project `tsconfig.app.json` tiene `"include": ["src"]`.** Consecuencias reales si se invierte la dirección (fuente viviendo en `supabase/functions/_shared/`, re-export desde `src/shared/`):

- **Vite/Vitest en runtime**: funcionan correctamente — resuelven el import.
- **`tsgo` / editor TS**: los archivos bajo `supabase/functions/` NO están en el `include` del proyecto app. Al importarlos desde `src/`, TypeScript los tratará como *dependencia externa sin tipos del proyecto*: hará type-check "best-effort" leyendo el archivo referenciado, pero:
  - No se aplicarán las mismas reglas de compilación del proyecto app.
  - Los tipos usados por esos archivos (por ejemplo, si `src/shared/prosaBancos/index.ts` re-exporta un tipo cuya definición vive en `supabase/functions/...`) pueden verse como `any` en el editor bajo ciertas configuraciones, o generar ruido en el diagnóstico.
  - Además: los archivos Deno en `supabase/functions/` usan **imports con extensión `.ts` explícita** (`../foo.ts`). Vite/TSX en modo bundler tolera esto con `allowImportingTsExtensions: true` (ya está activo), pero mezclar convenciones puede generar fricción.
- **No es un bloqueo, es una molestia de DX/tipado.**

### ¿Vite lo "desaconseja"?

No hay una recomendación oficial explícita en contra, pero la convención de Vite/React es: **todo el código de aplicación vive bajo `src/`**. Salir de `src/` para importar código de otro subproyecto es una señal de que el monorepo debería resolverse con workspaces o con una capa `shared/` en la raíz. Funciona, pero rompe la mental model.

---

## Recomendación (para tu decisión, no aplicada)

Con estos dos datos confirmados, las opciones se ordenan así:

### Opción A — Invertir dirección de re-exports (fuente en `supabase/functions/_shared/`, re-export desde `src/shared/`)
- ✅ Corrige el bundle de edge functions (sandbox limitation resuelta).
- ✅ Solo 8 archivos afectados (4 fuente + 4 re-export).
- ⚠️ Fricción de tipado/DX en el frontend porque el código pasa a vivir fuera del `include` del `tsconfig.app.json`.
- 🔧 **Mitigación**: extender `tsconfig.app.json` para incluir `"../supabase/functions/_shared/**/*.ts"` — pero eso mete Deno-flavored code en el mismo project TS del frontend, mezclando runtimes (browser vs Deno globals).

### Opción B — Mover la fuente a una carpeta neutra fuera de ambos (`packages/shared/` o `shared/` en raíz)
- ✅ Cero fricción conceptual: ninguna de las dos capas "sale de su casa".
- ✅ Vite y Deno pueden apuntar a la misma fuente.
- ⚠️ Requiere mover 4 archivos + actualizar 8 rutas de import + posible ajuste de `tsconfig`.
- Es la solución "monorepo-clean" real.

### Opción C — `import_map.json` por función (Deno-only)
- ✅ Cero cambios en `src/`.
- ⚠️ Requiere infra por-función y sincronización manual; agrega ceremonia.

**Sin acción todavía.** Esperando tu priorización para decidir A/B/C y ejecutar en un turno posterior.
