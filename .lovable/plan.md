# Diagnóstico: por qué Cloudflare rechaza un token que el widget dio por válido

## Estado actual (verificado)

- `supabase/functions/auth-captcha-proxy/index.ts` no tiene ningún `console.log`. `verifyTurnstile` reduce toda la respuesta de Cloudflare a un booleano (`outcome?.success === true`) y descarta `error-codes`, `challenge_ts` y `hostname`.
- Los logs de la función solo muestran eventos `booted` / `shutdown` (últimas invocaciones entre 21:12 y 21:16 UTC). Sin errores ni excepciones: el 400 fue una respuesta deliberada del código, no un crash.
- Conclusión: hoy es imposible saber la causa. Hay que instrumentar.

## Cambio propuesto (mínimo, solo observabilidad)

Un solo archivo: `supabase/functions/auth-captcha-proxy/index.ts`.

1. `verifyTurnstile` pasa a devolver el objeto completo de Cloudflare en vez de un booleano:
   - `{ success, errorCodes, hostname, challengeTs }`.
2. Cuando `success !== true`, loguear con `console.error` un JSON compacto con:
   - `error-codes` (array crudo de Cloudflare)
   - `hostname` devuelto por Cloudflare
   - `challenge_ts`
   - `action` recibida (`signin` / `signup`)
   - longitud del token recibido (no el token)
   - si `TURNSTILE_SECRET_KEY` está presente (booleano, nunca el valor)
   - el `origin` / `referer` de la petición
3. En caso de éxito, un `console.log` de una línea con `action` y `hostname` para correlacionar.
4. El mensaje que ve el usuario final **no cambia**: sigue siendo "Verificación de seguridad fallida. Intenta de nuevo." con status 400. Nada de exponer `error-codes` al cliente.

## Seguridad

- Nunca se loguea el secret, el token completo, ni la contraseña. Solo el nombre del código de error de Cloudflare y metadatos de hostname.

## Cómo se valida

1. Desplegar la función.
2. Reproducir el fallo desde el login real (preview y/o dominio publicado).
3. Leer los logs y obtener el `error-codes` exacto.
4. Según el código, la corrección es distinta y se decide después:
   - `invalid-input-secret` → el secret guardado no corresponde al site key del widget.
   - `timeout-or-duplicate` → el token se está reutilizando o expiró (>300s); hay que resetear el widget antes de cada envío.
   - `invalid-input-response` → site key y secret pertenecen a widgets distintos.
   - `hostname-mismatch` → falta autorizar el hostname del preview en Cloudflare.

Este plan solo agrega el logging. La corrección real será un paso aparte, ya con la evidencia en mano.
