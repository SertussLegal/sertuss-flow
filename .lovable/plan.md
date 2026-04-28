# Fase 3 — Helper aiFetch + refactor de 3 edge functions

## Objetivo
Centralizar las llamadas al AI Gateway de Lovable y eliminar por construcción los `TS18047` ("Object is possibly 'null'") en `scan-document`, `process-expediente` y `generate-document`. Unificar retries, manejo de 402/429 y parseo de tool calls.

`validar-con-claude` queda fuera (usa Anthropic directo, shape distinta, fallback silencioso por diseño).

## Cambios

### 1. Nuevo `supabase/functions/_shared/aiFetch.ts`
Helper compartido que expone:
- **`fetchAiGateway({ apiKey, body, maxRetries?, backoffMs?, tag? })`** → `Response` no-null o lanza `AiGatewayError`. Reintenta en 502/503/429 con backoff lineal (default 2 retries, 2000ms base). Captura errores de red.
- **`AiGatewayError`** (extiende `Error`, con `status` + `rawBody`) — preserva status code original.
- **`aiGatewayErrorResponse(err, corsHeaders)`** → mapea a `Response` con CORS y status correcto (preserva 402/429, normaliza el resto a 500). Retorna `null` si no es error de gateway.
- **`parseToolCallArguments<T>(response)`** → extrae y parsea `choices[0].message.tool_calls[0].function.arguments`. Lanza `AiGatewayError(502)` si falta tool call o JSON inválido.

### 2. Refactor `scan-document/index.ts`
Reemplaza el `for` loop de retries (~432-473) y el parseo manual (~475-498) por:
```ts
let response: Response;
try {
  response = await fetchAiGateway({ apiKey: LOVABLE_API_KEY, body: JSON.parse(aiBody), tag: "scan-document" });
} catch (err) {
  const r = aiGatewayErrorResponse(err, corsHeaders);
  if (r) return r;
  throw err;
}
const extractedData = await parseToolCallArguments<Record<string, unknown>>(response);
```
Logs de respuesta cruda y keys extraídos se mantienen.

### 3. Refactor `process-expediente/index.ts`
Mismo patrón en el bloque de fetch + `if (!response.ok)` + parseo (~150-195). Persistencia en `tramites.metadata` y `logs_extraccion` intacta.

### 4. Refactor `generate-document/index.ts`
Mismo patrón en ~120-166. Mapeo de 402/429/500 ahora viene del helper.

### 5. Fuera de scope
- `validar-con-claude` (Anthropic directo).
- Prompts en Google AI Studio.
- Schemas de tool calling.
- Frontend.

## Garantías
- **Sin TS18047**: tipos no-null por construcción; las cadenas `result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments` desaparecen.
- **Status codes preservados**: 402 → cliente puede emitir `credits:blocked`; 429 → cliente puede reintentar.
- **Backward compatible**: misma URL, mismo body, mismas response shapes. Cero impacto visible en el frontend.
- **Logs**: cada intento fallido loguea status + 300 chars del body con prefijo `[scan-document]`, `[process-expediente]`, `[generate-document]`.

## Verificación post-build
1. Deploy de las 3 funciones (`supabase--deploy_edge_functions`).
2. Smoke test OPTIONS preflight en las 3 (CORS 200).
3. Revisar `edge_function_logs` para confirmar tags nuevos en logs reales.
4. `rg "Response \| null"` en `supabase/functions/` → 0 matches esperados.
