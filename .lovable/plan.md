## Contexto

El caso `79ed163f` falló con `Upstream idle timeout exceeded` a los ~181s. Evidencia:

- Un único error `AI gateway 200 with provider error code=504` durante la ejecución en background.
- V6 corre en paralelo (`Promise.allSettled`, no serial) y no está en la ruta de error — el error viene de la promesa `mono` (Gemini 2.5 Pro sobre las 33 páginas).
- Caso exitoso previo (`0443d2f1`) mandó **más** páginas (41) y terminó en 126s → no es límite de páginas ni regresión de V6.
- `supabase/functions/_shared/aiFetch.ts:99` sólo reintenta `500|502|503|429`. El 504 no reintentó y salió directo como fallo.

Diagnóstico: **timeout transitorio de Gemini 2.5 Pro en el monolítico**, no reintentado porque 504 no está en la lista de reintentables.

## Alcance

Solo dos cambios chicos, sin tocar V6, sin tocar el flujo de UX ni la lógica de merge:

### 1. Agregar 504 a la lista de reintentables en `aiFetch.ts`

Archivo: `supabase/functions/_shared/aiFetch.ts`

- Línea ~99 (retry HTTP): incluir 504 junto a 429/502/503.
- Línea ~93 (retry sobre inner provider error): incluir 504 junto a 500/502/503/429.

Efecto: el 504 transitorio de Gemini se reintenta 2 veces adicionales con backoff lineal 2s/4s. Es exactamente el patrón que ya usa el 502 upstream.

### 2. (Opcional, mismo turno) Ampliar telemetría del monolítico

Archivo: `supabase/functions/procesar-cancelacion/index.ts`, bloque `logPoderEvent` líneas 2386-2404.

Agregar al `extra`:
- `mono_status: monoSettled.status` (hoy solo se loguea `dedicated_status`, aunque el que rompe es el monolítico).
- `v6_status: v6Settled.status` y `v6_enabled: POWER_V6_EXTRACTOR_ENABLED`.

Efecto: la próxima vez que falle sabemos en un solo query cuál de las tres promesas rompió, sin adivinar por logs.

## Fuera de alcance

- **No** desactivar V6. Evidencia demuestra que no participó en este fallo.
- **No** cambiar timeouts globales de la edge function ni del gateway (no los controlamos y el `attempt=1/3` sugiere que 504 vino de Google, no de nosotros).
- **No** partir el monolítico en subpromesas o pre-resumir páginas — cambio grande sin evidencia de que sea necesario todavía.
- **No** tocar el pipeline v6, la caché OCR ni el schema del poder.

## Verificación

1. `bunx vitest run` para confirmar que no rompe nada (los tests de `aiFetch` que existan cubren el matcher de reintentables).
2. Redeploy de `procesar-cancelacion`.
3. Reprocesar la misma cancelación `79ed163f` desde la UI (o via `reprocess_poder` si el usuario prefiere solo el paso del poder). Si el 504 era transitorio, ahora los 2 reintentos deberían absorberlo.
4. Confirmar en `system_events` que `mono_status=fulfilled` en la corrida siguiente.

## Rollback

Revertir el diff de `aiFetch.ts` (2 líneas) y redeploy. Cambio quirúrgico, sin migración ni flags.

## Recomendación

Aplicar los 2 cambios juntos. El #1 arregla la clase de error observada; el #2 evita otra sesión de diagnóstico a ciegas si vuelve a pasar.
