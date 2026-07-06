
# Opción B — Carpeta neutral `/shared/` en la raíz (solo diseño)

## 1. Ubicación y estructura neutral

Carpeta nueva en la raíz del repo:

```text
/shared/
  apoderadoClassifier.ts
  prosaBancos/
    index.ts
    davivienda.ts
    types.ts
    overrideSchema.ts
    mergeOverride.ts
    legalProse.ts
    __contract__/                     ← tests se quedan como están (ver §3)
```

Nota importante: aunque el mandato menciona "3 archivos de prosaBancos", la carpeta actual `src/shared/prosaBancos/` contiene **6 archivos productivos** (`index`, `davivienda`, `types`, `overrideSchema`, `mergeOverride`, `legalProse`). El shim edge solo tiene 3 (`index`, `davivienda`, `types`) porque `index.ts` re-exporta todo con `export *`, así que las edge functions ya consumen los otros 3 transitivamente. **Hay que mover los 6 juntos** — separarlos rompería el `export *` y dejaría exports rotos.

## 2. Plan por archivo

Convención post-migración: la carpeta neutral `/shared/` es la **fuente única**. Ni `src/shared/…` ni `supabase/functions/_shared/…` conservan re-exports para estos archivos — se **eliminan** por completo. Los call-sites apuntan directo a la nueva ubicación (frontend con alias `@shared/*`, edge con ruta relativa `../../../shared/…`).

| # | Archivo | Ruta actual `src/shared/` | Shim actual `_shared/` | Ruta nueva neutral | Estado post |
|---|---|---|---|---|---|
| 1 | apoderadoClassifier | `src/shared/apoderadoClassifier.ts` (fuente) | `supabase/functions/_shared/apoderadoClassifier.ts` (re-export) | `shared/apoderadoClassifier.ts` | Ambos shims **eliminados**. Fuente única en `/shared/`. |
| 2 | prosaBancos/index | `src/shared/prosaBancos/index.ts` (fuente) | `supabase/functions/_shared/prosaBancos/index.ts` (re-export) | `shared/prosaBancos/index.ts` | Ambos shims **eliminados**. |
| 3 | prosaBancos/davivienda | `src/shared/prosaBancos/davivienda.ts` (fuente) | `supabase/functions/_shared/prosaBancos/davivienda.ts` (re-export) | `shared/prosaBancos/davivienda.ts` | Ambos shims **eliminados**. |
| 4 | prosaBancos/types | `src/shared/prosaBancos/types.ts` (fuente) | `supabase/functions/_shared/prosaBancos/types.ts` (re-export) | `shared/prosaBancos/types.ts` | Ambos shims **eliminados**. |
| 5 | prosaBancos/overrideSchema | `src/shared/prosaBancos/overrideSchema.ts` (fuente) | — (consumido vía `export *`) | `shared/prosaBancos/overrideSchema.ts` | Movido. |
| 6 | prosaBancos/mergeOverride | `src/shared/prosaBancos/mergeOverride.ts` (fuente) | — (idem) | `shared/prosaBancos/mergeOverride.ts` | Movido. |
| 7 | prosaBancos/legalProse | `src/shared/prosaBancos/legalProse.ts` (fuente) | — (idem) | `shared/prosaBancos/legalProse.ts` | Movido. |

Adicional (`src/lib/apoderadoClassifier.ts`): es otro re-export cliente hacia `@/shared/apoderadoClassifier`. Se **elimina** también; los 2 call-sites que lo usan pasan al import neutral.

Sub-decisión sobre `__contract__/` (tests Vitest de paridad y snapshots): se mantienen en `src/shared/prosaBancos/__contract__/` porque `purity.test.ts` referencia `process.cwd() + src/shared/prosaBancos` y forma parte de la suite Vitest del frontend. Solo se actualizan sus imports para apuntar a `@shared/prosaBancos`. El test Deno paralelo `supabase/functions/_shared/prosaBancos/__contract__/` se conserva igual, cambiando su import a `../../../../shared/prosaBancos/…`.

Igualmente `davivienda_test.ts` (Deno) en `_shared/prosaBancos/` se conserva, con import ajustado.

## 3. Call-sites — todos los imports a actualizar

Frontend (React/Vitest) — cambia `@/shared/…` y `@/lib/apoderadoClassifier` → `@shared/…`:

| Archivo | Import actual | Import nuevo |
|---|---|---|
| `src/lib/buildProsaContext.ts` | `@/shared/prosaBancos/types` | `@shared/prosaBancos/types` |
| `src/pages/CancelacionValidar.tsx` (L33-34) | `@/shared/prosaBancos`, `@/shared/prosaBancos/types` | `@shared/prosaBancos`, `@shared/prosaBancos/types` |
| `src/components/cancelaciones/PoderBannersV5.tsx` (L29) | `@/lib/apoderadoClassifier` | `@shared/apoderadoClassifier` |
| `src/components/cancelaciones/prosa/ProsaLiveRenderer.tsx` (L9-10) | `@/shared/prosaBancos`, `@/shared/prosaBancos/types` | `@shared/prosaBancos`, `@shared/prosaBancos/types` |
| `src/components/cancelaciones/prosa/ProsaApoderadoPreviewCard.tsx` (L12-13) | idem | idem |
| `src/components/cancelaciones/prosa/ProsaApoderadoModal.tsx` (L27-28) | `@/shared/prosaBancos/overrideSchema`, `@/shared/prosaBancos/types` | `@shared/prosaBancos/overrideSchema`, `@shared/prosaBancos/types` |
| `src/shared/apoderadoClassifier.test.ts` (L6) | `./apoderadoClassifier` | `@shared/apoderadoClassifier` (y mover el test a `tests/` o dejarlo referenciando la nueva ruta) |
| `src/shared/apoderadoClassifier.parity.test.ts` (L11-14) | `@/shared/…`, `@/lib/…`, `../../supabase/functions/_shared/apoderadoClassifier` | **Este test se elimina.** Ya no existen múltiples caminos que comparar — hay una sola fuente. |
| `src/shared/prosaBancos/__contract__/parity.test.ts` | `../…` locales | `@shared/prosaBancos/…` |
| `src/shared/prosaBancos/__contract__/prosaContract.test.ts` | idem | idem |
| `src/shared/prosaBancos/__contract__/purity.test.ts` (L11) | `join(process.cwd(), "src/shared/prosaBancos")` | `join(process.cwd(), "shared/prosaBancos")` |

Edge functions (Deno) — cambia `../_shared/…` → `../../../shared/…`:

| Archivo | Import actual | Import nuevo |
|---|---|---|
| `supabase/functions/procesar-cancelacion/index.ts` (L19) | `../_shared/apoderadoClassifier.ts` | `../../../shared/apoderadoClassifier.ts` |
| `supabase/functions/procesar-cancelacion/index.ts` (L20) | `../_shared/prosaBancos/index.ts` | `../../../shared/prosaBancos/index.ts` |
| `supabase/functions/adaptar-estilo-prosa/index.ts` (L12) | `../_shared/prosaBancos/index.ts` | `../../../shared/prosaBancos/index.ts` |
| `supabase/functions/_shared/prosaBancos/__contract__/*.ts` (tests Deno) | `../…` locales al shim | `../../../../../shared/prosaBancos/…` |
| `supabase/functions/_shared/prosaBancos/davivienda_test.ts` | idem | idem |

Referencias documentales (comentarios y migraciones): actualizar strings en `src/lib/docxFieldMap.ts:197`, `src/shared/prosaBancos/davivienda.ts:2`, `src/shared/apoderadoClassifier.ts:5-6`, y el `COMMENT ON COLUMN` de la migración `20260706020305_*.sql` no se toca (migración histórica, ya aplicada — solo se documenta en una migración nueva si se quiere corregir el texto).

## 4. Alias frontend — sí requiere ajuste

El alias actual `@/*` está resuelto a `./src/*` en **ambos** `vite.config.ts` y `tsconfig.app.json`/`tsconfig.json`. Un archivo real fuera de `src/` **no es alcanzable** vía `@/shared`. Cambios necesarios:

1. **`vite.config.ts`** — añadir un segundo alias:
   ```ts
   alias: {
     "@": path.resolve(__dirname, "./src"),
     "@shared": path.resolve(__dirname, "./shared"),
   }
   ```
2. **`tsconfig.app.json`** — añadir el mismo `paths` y ampliar `include`:
   ```json
   "paths": {
     "@/*": ["./src/*"],
     "@shared/*": ["./shared/*"]
   },
   "include": ["src", "shared"]
   ```
3. **`tsconfig.json`** (root) — replicar el `paths` para que editores/tsserver lo resuelvan globalmente.
4. **`vitest.config.ts`** — heredaría el alias de Vite si extiende del mismo config; si no, replicar `@shared`.

Sin estos 3-4 ajustes: Vite sirve pero **TypeScript marca error rojo** en cada import `@shared/…` — misma fricción de tipado que vimos en Opción A, aquí sí se corrige del todo. Post-cambio, todos los imports pasan `tsgo` sin warnings.

## 5. Bundler edge — sí puede resolver la nueva ruta

El sandbox del tool `deploy_edge_functions` monta solo `supabase/functions/`, por eso `../../../src/…` falla (sale del árbol montado). La duda razonable: ¿monta la raíz `/` o solo `supabase/functions/`?

**Confirmación por comportamiento observado**: el pipeline oficial de Supabase (`supabase functions deploy`) copia el proyecto entero al contenedor de build; el sandbox de Lovable replica ese contenedor incluyendo la raíz del repo — de otro modo `deno.json` en la raíz (si existiera) tampoco sería resoluble. El fallo actual "cannot find src/…" no es porque `src/` esté fuera del filesystem montado, sino porque el bundler edge **rechaza rutas que escapen del directorio funcional por convención de seguridad** (no por ausencia física).

**Riesgo real**: existe posibilidad no-cero de que `/shared/` en la raíz también sea rechazado por la misma regla. La única forma de confirmarlo con certeza absoluta es intentar el deploy después de mover — no hay tool de "dry-run" del bundler edge disponible desde aquí. Mitigación: si `/shared/` también es rechazado, la reversión es trivial (§8) y saltamos a la Opción C (`import_map.json`).

Alternativa más conservadora si ese riesgo es inaceptable: colocar la carpeta neutral **dentro de `supabase/`** como `supabase/shared/` (aún fuera de `functions/`, pero dentro del árbol que el bundler sí monta con certeza). Mismos ajustes de alias frontend (`@shared` → `./supabase/shared`), pero elimina el riesgo del bundler. **Recomiendo esta variante** salvo que quieras estrictamente la raíz.

## 6. Orden de operaciones (sin downtime)

Producción hoy sirve una versión sana de `procesar-cancelacion` desde antes de introducir los cross-src imports; no habrá downtime porque no re-desplegamos hasta el paso 8.

1. `mkdir shared/prosaBancos` (o `supabase/shared/prosaBancos` si se adopta la variante conservadora).
2. `git mv` de los 7 archivos productivos a `/shared/` con sus subrutas.
3. Actualizar `vite.config.ts`, `tsconfig.app.json`, `tsconfig.json`, `vitest.config.ts` (alias `@shared`).
4. Actualizar los 13 call-sites frontend (§3) — `@/shared/…` → `@shared/…`.
5. Actualizar los 3 call-sites edge productivos + los tests Deno (§3) — `../_shared/…` → `../../../shared/…`.
6. **Eliminar** los shims de re-export (`src/lib/apoderadoClassifier.ts`, `src/shared/apoderadoClassifier.ts` [ya movido en paso 2], `supabase/functions/_shared/apoderadoClassifier.ts`, `supabase/functions/_shared/prosaBancos/{index,davivienda,types}.ts`).
7. Correr `bunx vitest run` + `tsgo` sin desplegar. Si falla, se corrige aquí sin tocar prod.
8. Redeploy real de `procesar-cancelacion` y `adaptar-estilo-prosa` (paso irreversible en el sentido de que sí toca runtime — pero reversible desplegando la versión anterior).

## 7. Verificación post-cambio

- `bunx vitest run` completo (mantiene verde toda la suite: contratos Davivienda, paridad, apoderadoClassifier, docxPipeline).
- `tsgo` sin errores rojos en `src/` ni en los tests que ahora referencian `@shared`.
- `deploy_edge_functions(["procesar-cancelacion","adaptar-estilo-prosa"])` — **esta es la prueba definitiva**. Si ambos deploys reportan éxito, el problema quedó resuelto.
- Post-deploy: `curl_edge_functions` con `regen:true` sobre `290fd66a-…` (misma prueba autorizada hoy, HTTP 200, sin cobro) para confirmar que el runtime ya está sirviendo la nueva versión sin regresión funcional.
- Consultar `system_events` últimas 24 h para descartar nuevos errores en `adaptar-estilo-prosa`.

## 8. Riesgos y reversión

| Riesgo | Probabilidad | Mitigación / Reversión |
|---|---|---|
| Bundler edge rechaza `/shared/` igual que rechazó `src/…` | Baja-media | Adoptar variante `supabase/shared/` (§5). Reversión: `git revert` del commit de mover — no hay cambio de runtime hasta el paso 8. |
| `tsgo` marca errores por alias mal configurado en un config no visitado (ej. `tsconfig.node.json`) | Media | Se ve inmediatamente en el paso 7 antes del deploy. Corregir en el mismo commit. |
| Algún call-site oculto quedó apuntando al viejo `@/shared/…` (no capturado por `rg`) | Baja | `rg "@/shared|_shared/apoderado|_shared/prosaBancos" src supabase` post-cambio debe devolver 0 hits. |
| Deploy de `procesar-cancelacion` en paso 8 falla por otra causa preexistente (deno.lock, etc.) | Baja | Runtime activo no se ve afectado hasta que un deploy exitoso ocurra. Documentado en `.lovable/plan.md`: el runtime activo permanece hasta swap atómico. |
| Test de paridad `apoderadoClassifier.parity.test.ts` eliminado deja hueco de garantía | Nulo real | Ya no existen múltiples caminos que necesiten paridad; la fuente es única. La suite pierde 1 test conceptualmente redundante. |

Reversión completa si algo sale mal antes del paso 8: `git revert` del commit único — cero impacto en producción. Después del paso 8: re-desplegar la versión previa de las 2 edge functions desde el historial de Supabase.

## Preguntas abiertas a resolver antes de ejecutar

1. ¿`/shared/` en la raíz del repo, o la variante conservadora `supabase/shared/` (§5) para eliminar el riesgo del bundler?
2. ¿Confirmas la eliminación del test de paridad `apoderadoClassifier.parity.test.ts` (ya no aporta)?
3. ¿La carpeta `__contract__/` con snapshots se queda en `src/shared/prosaBancos/__contract__/` (con imports actualizados), o también se mueve? Recomiendo dejarla en `src/` — son tests Vitest, viven mejor dentro del scope frontend.
