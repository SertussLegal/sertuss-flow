
# Verificación de la alerta "Cancelation document generation fails to start"

## Evidencia recogida ahora (read-only)

### 1. `src/shared/prosaBancos/index.ts` — NO EXISTE como fuente
```
src/shared/prosaBancos/
└── __contract__/          ← solo tests
    ├── overrideSchema.test.ts
    ├── parity.test.ts
    ├── prosaContract.test.ts
    ├── purity.test.ts
    └── referencia_davivienda.contract.json
```
No hay `index.ts` ni shim de re-exportación. Solo suite de contract tests.

### 2. `overrideSchema.ts` real vive en el paquete isomórfico
- Ruta única: `supabase/functions/_shared/isomorphic/prosaBancos/overrideSchema.ts`
- Alias configurado en `tsconfig.app.json`: `@shared/* → supabase/functions/_shared/isomorphic/*` (el frontend importa por alias, no por shim).

### 3. `deno.json` sí existen — la alerta miente
```
supabase/functions/procesar-cancelacion/deno.json  →  { "imports": { "zod": "npm:zod@3.25.76" } }
supabase/functions/adaptar-estilo-prosa/deno.json  →  { "imports": { "zod": "npm:zod@3.25.76" } }
```
Confirmado: **no** existe `supabase/functions/deno.json` global ni `import_map.json`, pero **cada función** tiene su `deno.json` local que resuelve el bare specifier `"zod"` a `npm:zod@3.25.76`. En Supabase Edge Functions, el `deno.json` por función es el patrón soportado.

### 4. Imports actuales de los edge functions
- `procesar-cancelacion/index.ts` línea 20: importa desde `../_shared/isomorphic/prosaBancos/index.ts` (ruta real, no shim).
- `adaptar-estilo-prosa/index.ts` línea 12: idem.
- `overrideSchema.ts` en Deno resuelve `"zod"` vía el `deno.json` local ✔.

## Diagnóstico

**La alerta describe un estado anterior del código.** Antes de la migración a `_shared/isomorphic/prosaBancos/` existió un shim en `src/shared/prosaBancos/index.ts` que re-exportaba módulos, y en algún punto el `overrideSchema` usaba `import "zod"` sin `deno.json`. Hoy:

| Afirmación de la alerta | Estado real hoy |
|---|---|
| Shim `src/shared/prosaBancos/index.ts` re-exporta | ❌ No existe |
| `overrideSchema.ts` con bare `"zod"` sin resolver | ❌ Resuelto por `deno.json` local de cada función |
| No hay `supabase/functions/deno.json` global | ✅ Cierto, pero irrelevante — cada función tiene el suyo |

Ninguno de los tres síntomas listados aplica al código actual. Los edge functions arrancan correctamente (los tests de contract del paquete isomórfico corren en verde en el frontend, y Deno resuelve `zod` en runtime).

## Hipótesis de por qué reapareció tras "Ignore"

Sin acceso a documentación interna del monitor de Lovable, doy 3 hipótesis en orden de probabilidad (con incertidumbre real):

1. **Ciclo nuevo tras deploy** — el monitor re-ejecuta su análisis estático en cada deploy exitoso y, si detecta la misma "clase" de patrón (edge function que importa de un paquete compartido con bare specifier), vuelve a emitir el hallazgo. "Ignore" probablemente silencia una **instancia** identificada por hash de código, no la regla; al cambiar el código, el hash cambia y reaparece. **Más probable.**
2. **Falso positivo del analizador estático** — el analizador de la alerta no lee `deno.json` por función y asume que `"zod"` es un import roto. "Ignore" se guardó, pero el próximo ciclo lo detectó como hallazgo nuevo porque escaneó otro archivo (`adaptar-estilo-prosa` vs `procesar-cancelacion`).
3. **"Ignore" no persistió** — menos probable, pero posible si el estado del monitor es por-sesión o si hubo un reset.

**No tengo forma de confirmar con certeza cuál de las tres es** — no hay documentación pública de cómo funciona el matching de "Ignore" en el monitor de issues de Lovable.

## Recomendación

- **No usar "Try to fix"**: aplicaría un cambio para arreglar un problema que no existe (probablemente re-crearía el shim o cambiaría los imports de `zod` a URL absoluta, rompiendo la arquitectura isomórfica actual respaldada por tests de paridad).
- **Usar "Ignore" de nuevo** con conciencia de que puede reaparecer en el próximo deploy — es ruido, no una regresión.
- **Opcional (siguiente iteración)**: si el ruido persiste, valorar mover el `deno.json` a `supabase/functions/deno.json` global o añadir un comentario `// deno-lint-ignore` cerca del import para que el analizador entienda que el bare specifier es intencional. **No se hace ahora** — esto es solo verificación.

## Restricción respetada

Solo lectura. No se tocó el monitor, no se desplegó nada, no se modificó código.
