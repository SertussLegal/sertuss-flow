# Fase 3 — Backend edge functions (helper aiFetch + refactor)

## Objetivo

Centralizar las llamadas al AI Gateway de Lovable en un único helper compartido y refactorizar las 3 funciones que lo consumen para eliminar por construcción los `TS18047` ("Object is possibly 'null'") y unificar el manejo de retries, 402, 429 y respuestas inválidas.

`validar-con-claude` queda fuera del scope: usa la API directa de Anthropic (no Lovable Gateway), tiene shape distinta y por diseño no debe lanzar errores al cliente (fallback silencioso).

## Cambios

### 1. Nuevo `supabase/functions/_shared/aiFetch.ts`

Helper compartido que expone:

- **`fetchAiGateway({ apiKey, body, maxRetries?, backoffMs?, tag? })`** → devuelve `Response` no-null o lanza `AiGatewayError`. Reintenta automáticamente en 502/503/429 con backoff lineal (`base * (attempt+1)`). Por defecto 2 retries (3 intentos totales), backoff 2000ms. Captura errores de red y los reintenta también.
- **`AiGatewayError`** (`Error` con `status` + `rawBody`) — preserva el status code original (especialmente 402 y 429) para que el frontend pueda reaccionar.
- **`aiGatewayErrorResponse(err, corsHeaders)`** → mapea `AiGatewayError` a `Response` con CORS y status code correcto (preserva 402/429, normaliza el resto a 500). Retorna `null` si el error no es de gateway, para que el caller delegue a su catch genérico.
- **`parseToolCallArguments<T>(response)`** → extrae y parsea `choices[0].message.tool_calls[0].function.arguments`. Lanza `AiGatewayError(502)` si la IA no devolvió tool call o el JSON es inválido. Elimina la cadena de optional-chains que producía TS18047.

### 2. Refactor `supabase/functions/scan-document/index.ts`

Reemplaza el bloque `let response: Response | null = null; for (...) { ... }` (líneas ~432-473) y el parseo de tool call (líneas ~475-498) por:

```ts
let response: Response;
try {
  response = await fetchAiGateway({
    apiKey: LOVABLE_API_KEY,
    body: JSON.parse(aiBody),
    tag: "scan-document",
  });
} catch (err) {
  const r = aiGatewayErrorResponse(err, corsHeaders);
  if (r) return r;
  throw err;
}

const extractedData = await parseToolCallArguments<Record<string, unknown>>(response);
```

Logging de la respuesta cruda y de los keys extraídos se mantiene.

### 3. Refactor `supabase/functions/process-expediente/index.ts`

Idéntico patrón: reemplaza el `fetch` directo + bloque `if (!response.ok)` + parseo manual (líneas ~150-195) por `fetchAiGateway` + `parseToolCallArguments<EditorResult>()`. La persistencia en `tramites.metadata` y `logs_extraccion` se mantiene exactamente igual.

### 4. Refactor `supabase/functions/generate-document/index.ts`

Mismo patrón en líneas ~120-166.

### 5. No se toca

- `validar-con-claude/index.ts` — distinta API, distinto shape, por diseño nunca propaga errores al cliente.
- Prompts (en Google AI Studio para scan-document y process-expediente) — no se tocan.
- Schemas de tool calling — no se tocan.

## Garantías

- **Sin TS18047**: `fetchAiGateway` retorna `Response` no-null por tipo, `parseToolCallArguments` retorna `T` no-null por tipo. Las cadenas `result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments` desaparecen del código de las 3 funciones.
- **Status codes preservados**: 402 sigue llegando como 402 al cliente → `services/credits.ts` puede emitir `credits:blocked` (Fase 4). 429 sigue llegando como 429 → cliente puede reintentar.
- **Backward compatible**: misma URL, mismo body, mismas response shapes para el cliente. Cero cambios visibles para el frontend en esta fase.
- **Idempotencia de despliegue**: las 3 funciones se vuelven a desplegar, el helper `_shared/aiFetch.ts` queda disponible para futuros callers (p.ej. nuevas funciones de generación de actos adicionales).
- **Logs**: cada intento fallido sigue logueando status + primeros 300 chars del body, con prefijo `[scan-document]` / `[process-expediente]` / `[generate-document]` para filtrar en `edge_function_logs`.

## Verificación post-build

1. `supabase--deploy_edge_functions` para `scan-document`, `process-expediente`, `generate-document`.
2. Smoke test con `supabase--curl_edge_functions` (OPTIONS preflight) en las 3 funciones — confirmar 200 + CORS headers.
3. Revisar `supabase--edge_function_logs` para confirmar que los nuevos tags `[scan-document]` etc. aparecen en logs reales después de un trámite.
4. Buscar con `rg "Response \| null"` en `supabase/functions/` → 0 matches esperados.

Aprueba para que pase a Build y aplique los 4 cambios en una sola tirada.