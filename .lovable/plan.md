# Plan: cerrar 3 hallazgos del Deep Security Scan

Solo diseño. Nada se ejecuta hasta tu OK.

## Hallazgo #1 — CRÍTICO: `adaptar-estilo-prosa` sin validación de JWT

### Contexto verificado
- Callers reales hoy: **1 solo** — `src/components/cancelaciones/prosa/ProsaApoderadoModal.tsx:136` vía `supabase.functions.invoke("adaptar-estilo-prosa", ...)`. `invoke()` inyecta automáticamente el `Authorization: Bearer <jwt>` del usuario logueado. Ningún caller anónimo legítimo → cambio seguro.
- Patrón canónico ya usado en `process-expediente/index.ts` (líneas 23-41) y `procesar-cancelacion/index.ts` (líneas 1554-1570): `getClaims(token)` con `SUPABASE_ANON_KEY` + client con Authorization header. Rechaza con 401.
- `supabase/config.toml`: NO tiene `[functions.process-expediente]` ni `[functions.procesar-cancelacion]` — ambas usan el default de Lovable Cloud (`verify_jwt = false`) y validan en código con `getClaims()`. **La regla del sistema** (`disable-jwt-edge-functions`) dice que con signing-keys el patrón correcto es `verify_jwt = false` + validación en código. **No hay que tocar `config.toml`**.

### Diff exacto propuesto para `supabase/functions/adaptar-estilo-prosa/index.ts`

Cambios:
1. Añadir import de `createClient`.
2. Insertar bloque de validación al inicio del `try` en `serve(...)`, antes de leer el body.

```diff
 import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
+import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 import { OverrideSchema } from "../_shared/isomorphic/prosaBancos/index.ts";

 const corsHeaders = { ... };

 const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
+const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
+const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
 const MODEL = "google/gemini-2.5-flash";
 ...

 serve(async (req) => {
   if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

   try {
     if (!LOVABLE_API_KEY) {
       return json({ error: "LOVABLE_API_KEY no configurada" }, 500);
     }
+
+    // JWT auth — evita que anónimos consuman el cupo de IA de Sertuss.
+    const authHeader = req.headers.get("Authorization");
+    if (!authHeader?.startsWith("Bearer ")) {
+      return json({ error: "Unauthorized" }, 401);
+    }
+    const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
+      global: { headers: { Authorization: authHeader } },
+    });
+    const { data: claimsData, error: claimsErr } = await sbUser.auth.getClaims(
+      authHeader.replace("Bearer ", ""),
+    );
+    if (claimsErr || !claimsData?.claims?.sub) {
+      return json({ error: "Unauthorized" }, 401);
+    }
+
     const body = (await req.json()) as Payload;
     ...
```

Nada más cambia — el resto del handler (validación MIME, tamaño, llamada al gateway, sanitización con `OverrideSchema`) se mantiene idéntico.

**`supabase/config.toml`: NO se toca.** Mismo patrón que las 2 funciones ya protegidas.

## Hallazgo #2 y #3 — Warnings: policies con rol `public` en vez de `authenticated`

### Estado real verificado (`pg_policies`)
| Tabla | Policy | roles actual | qual |
|---|---|---|---|
| `ocr_raw_cache` | `Members read their org cache` | `{public}` | `is_org_member(organization_id)` |
| `profiles` | `Users can view own profile` | `{public}` | `id = auth.uid()` |

Condición idéntica, solo cambia el rol al que aplica. Ambas ya son seguras en la práctica (anon no pasa `is_org_member` ni `auth.uid()`), pero el scanner exige `TO authenticated` para defensa en profundidad.

### Migración SQL exacta

```sql
-- Hallazgo #2: ocr_raw_cache
DROP POLICY "Members read their org cache" ON public.ocr_raw_cache;
CREATE POLICY "Members read their org cache"
  ON public.ocr_raw_cache
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Hallazgo #3: profiles
DROP POLICY "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());
```

Sin cambio de `USING`, sin cambio de `cmd`, sin cambio semántico.

## Confirmación de no-regresión

- **`adaptar-estilo-prosa`**: único caller frontend ya manda JWT vía `invoke()`. Usuarios no autenticados no llegan al modal `ProsaApoderadoModal` (requiere sesión activa y contexto de cancelación).
- **`ocr_raw_cache`**: lecturas hoy salen desde componentes del panel de cancelaciones (usuario logueado). Ningún flujo anónimo.
- **`profiles`**: `AuthContext.tsx` y el resto de lecturas ocurren post-login. Restringir a `authenticated` no cambia nada observable.

## Plan de verificación (post-aprobación)

1. `bunx vitest run` — esperamos 96/96 verde (los cambios no tocan tests).
2. **Prueba anónima negativa** vía shell:
   ```bash
   curl -i -X POST https://<project>.supabase.co/functions/v1/adaptar-estilo-prosa \
     -H "Content-Type: application/json" \
     -H "apikey: <anon-key>" \
     -d '{"fileBase64":"x","mimeType":"text/plain"}'
   # Esperado: HTTP/2 401 {"error":"Unauthorized"}
   ```
3. **Prueba autenticada positiva** vía Playwright con el JWT real (patrón `LOVABLE_BROWSER_SUPABASE_*`): invocar la función con un texto plano corto y confirmar respuesta 200 con `notas_sugeridas`.
4. Re-lectura de `pg_policies` para confirmar `roles = {authenticated}` en ambas policies migradas.
5. Prueba manual en el preview: abrir el `ProsaApoderadoModal`, adjuntar un `.txt` de referencia, confirmar que sigue devolviendo sugerencias (flujo end-to-end intacto).
6. Re-correr el Deep Security Scan — los 3 hallazgos deben desaparecer.

## Riesgos residuales

- Ninguno identificado. Los cambios son puramente aditivos (nueva validación) y de metadata (rol de policy).
- Rollback trivial si algo falla: revertir el bloque de auth en la edge y re-crear las 2 policies con `TO public`.

Nada se ejecuta hasta tu OK explícito.
