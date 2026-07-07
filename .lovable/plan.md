## Diagnóstico (ya investigado en el turno previo, evidencia concreta)

**Caso fallido:** `79ed163f-993e-4aa3-ac32-a35c85705a95` (Sertuss, Davivienda).
- Creado 21:40:49Z, `status=error` a 21:43:52Z → ~181s.
- `error_message="Upstream idle timeout exceeded"`.

**Logs edge (procesar-cancelacion):**
```
21:41:23  boot
21:43:50  ERROR AI gateway 200 with provider error code=504 msg=Upstream idle timeout exceeded attempt=1/3
21:43:50  ERROR [procesar-cancelacion bg] error: Upstream idle timeout exceeded
```
Un solo 504. Sin evento `[v6 extractor failed]`.

**Páginas subidas (`storage.objects`):** 33 = certificado 3 + escritura 10 + poder 20.

**Comparación con éxito previo** `0443d2f1` (21:09Z): 3+10+**28**=41 páginas → completó en 126s. El caso exitoso mandó MÁS páginas → descarta "el usuario subió demasiado".

**Arquitectura V6** (líneas 2350-2357 de `procesar-cancelacion/index.ts`): `Promise.allSettled([mono, dedicated, v6])` — **paralelo, no secuencial**. Solo `mono` (Gemini 2.5 Pro sobre las 33 páginas) es obligatorio; `v6Runner` (2340-2348) atrapa su propio error. La activación de V6 no serializa ni empuja el tiempo del monolítico.

**Cuál promesa falló:** el único 504 y el `bg error` provienen del `mono` (única promesa cuyo reject propaga a `throw` en 2360-2362). `dedicated` y `v6` tienen etiquetas propias que no aparecen en logs.

**Por qué no reintentó:** `supabase/functions/_shared/aiFetch.ts:96` marca reintentables `500|502|503|429`. **504 no está en la lista** → falló a la primera ("attempt=1/3").

**Veredicto:**
- **No es regresión de V6.** V6 corre en paralelo; caso exitoso previo con V6 activo y más páginas terminó en 126s.
- **No es exceso de páginas del usuario.**
- **Es un 504 transitorio de Gemini 2.5 Pro** en la llamada monolítica, no reintentado porque `aiFetch` no considera 504 reintentable.

## Alcance de la corrección

Dos cambios chicos, sin tocar V6:

### 1. Agregar 504 a reintentables en `supabase/functions/_shared/aiFetch.ts`

- Línea ~96 (inner provider error): incluir 504 junto a 500/502/503/429.
- Línea ~99 (HTTP status): incluir 504 junto a 429/502/503.

Efecto: 504 transitorio se reintenta 2 veces con backoff lineal 2s/4s. Mismo patrón que ya usa 502.

### 2. Ampliar telemetría en `procesar-cancelacion/index.ts` (`logPoderEvent`, líneas 2386-2404)

Agregar al `extra`:
- `mono_status: monoSettled.status`
- `v6_status: v6Settled.status`
- `v6_enabled: POWER_V6_EXTRACTOR_ENABLED`

Efecto: si vuelve a fallar, se identifica qué promesa rompió con un solo query.

## Fuera de alcance

- No desactivar V6 (evidencia demuestra que no participó).
- No re-arquitecturar a job/polling con `EdgeRuntime.waitUntil` — el pipeline ya corre en background (línea 2272 `heavyWork`), y el problema no es el timeout de la edge sino un 504 upstream de Google. Un patrón de job queue no lo evitaría; sí lo evita el reintento.
- No partir el monolítico ni tocar caché/schema.

## Verificación

1. `bunx vitest run` (verde).
2. Redeploy de `procesar-cancelacion`.
3. Reprocesar `79ed163f` desde la UI; confirmar `mono_status=fulfilled` en `system_events`.

## Rollback

Revertir el diff de `aiFetch.ts` (2 líneas) y redeploy.
