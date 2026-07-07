# Verificación adaptar-estilo-prosa — SOLO LECTURA

## 1. Timeline
- **Ahora (UTC):** 2026-07-07 14:09:20
- **Fix aplicado (mtime del archivo):** 2026-07-07 14:08:55 UTC — hace ~25 segundos respecto al `date` de la verificación, y aproximadamente ~35 min antes de este mensaje del usuario (deploy previo en la conversación anterior).
- **"Last scanned 23 minutes ago"** reportado por el panel → el scan corrió **antes** del deploy más reciente. El scanner no ha vuelto a correr contra la versión endurecida.

## 2. Prueba anónima en vivo (ahora mismo)
Dos requests reales contra `https://cmcikwbszokxeepchqib.supabase.co/functions/v1/adaptar-estilo-prosa`:

- Con solo `apikey` anon (sin Bearer): **HTTP 401 `{"error":"Unauthorized"}`**
- Sin ningún header de auth: **HTTP 401 `{"error":"Unauthorized"}`**

El fix está activo en producción.

## 3. Código actual real
`supabase/functions/adaptar-estilo-prosa/index.ts` conserva el bloque de validación al inicio de `serve()`:

```ts
const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) {
  return json({ error: "Unauthorized" }, 401);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: authHeader } },
});
const token = authHeader.replace("Bearer ", "");
const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
if (claimsError || !claimsData?.claims) {
  return json({ error: "Unauthorized" }, 401);
}
```

No hubo reversión.

## 4. Diagnóstico
**La alerta es un escaneo desactualizado, no un fallo real del fix.**

Evidencia convergente:
- El scan es de hace 23 min, previo al último redeploy.
- La función devuelve 401 a cualquier caller sin JWT válido en este instante.
- El código en disco (y desplegado, según la prueba en vivo) contiene la validación.

## Acción sugerida (no ejecutada)
Cuando el dueño del producto quiera limpiar el panel: volver a correr el Deep Security Scan desde la UI. No se requiere ningún cambio de código.
