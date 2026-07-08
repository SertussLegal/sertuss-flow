# Fase 2 — Contraste dirigido con Claude sobre PDF fuente

## Reporte de auditoría (evidencia)

### 1. Integraciones con la API de Anthropic hoy en el proyecto

Solo hay **dos** edge functions que hablan directo con `api.anthropic.com`; el resto de menciones a "claude" en `src/` son nombres de archivos legacy (`validacionClaude.ts` stub que solo exporta el tipo `Validacion`) o comentarios.

| Archivo | Línea | Modelo | Estado real |
|---|---|---|---|
| `supabase/functions/validar-con-claude/index.ts` | 5, 122, 130 | `claude-sonnet-4-20250514` | **En cuarentena**. Deployado, pero ningún archivo en `src/` lo invoca (`rg` sobre `src/` confirma 0 llamadas a `invoke("validar-con-claude"…)`). Retirado del flujo en vivo, reemplazado por `computeTopIssues` determinista. |
| `supabase/functions/descubrir-reglas/index.ts` | 19-20, 163 | `claude-sonnet-4-5-20250929` | **Activo, offline**. Invocado manualmente desde `src/components/admin/ReglasPropuestas.tsx:216`. Corridas puntuales (no cron). |

`process-expediente/index.ts` aparece en el grep pero solo por strings/comentarios; usa Gemini vía gateway, no Anthropic (sin `fetch` a `api.anthropic.com`).

`CLAUDE_API_KEY` está presente en `<supabase-configuration>` — no hace falta pedirla al usuario.

### 2. ¿`descubrir-reglas` ve el documento fuente?

**No.** `descubrir-reglas/index.ts:145-177` construye un `patternsPayload` que es puro texto/JSON agregado a partir del diff `data_ia` vs `data_final` de `logs_extraccion`, más el catálogo `reglas_validacion`. Se manda como `messages: [{ role: "user", content: userPrompt }]` — un solo bloque de texto. **Claude nunca recibe el PDF ni imágenes**; solo cuenta y redacta patrones ya consolidados por código determinista. Sirve para su rol actual (categorizar patrones), pero es inservible para verificación independiente contra la fuente.

### 3. ¿Hay acceso al PDF original en el momento del contraste?

Sí. Los soportes se guardan en el bucket privado `expediente-files` (ver `<storage-buckets>` y `procesar-cancelacion/index.ts:47` `BUCKET_OUTPUT = "expediente-files"`). El mismo `procesar-cancelacion/index.ts:1262` ya usa `storage.from(...).createSignedUrl(path, 60*30)` — el patrón de firma de URL a 30 min ya está resuelto en la función que correría el contraste.

Formato de envío a Claude: la Messages API acepta **PDF nativo** vía bloque `document` con `source.type: "base64"` y `media_type: "application/pdf"` (Sonnet 4/4.5). Alternativa: convertir a imágenes por página y mandarlas como `image` blocks base64. Hoy `scan-document/shared/runGemini.ts:28-32` ya trabaja con base64/data-URI para Gemini — el patrón está en casa, pero es Gemini, no Claude. Para Claude habría que armar el bloque `document` correcto (no está hecho hoy en ningún lado).

### 4. Modelos y referencia de costo/latencia

- `validar-con-claude`: `claude-sonnet-4-20250514`, `max_tokens: 4096`, sin tools (texto libre parseado post-hoc). No hay métricas guardadas en tabla propia; historial estaría en `activity_logs` si se registró, pero la función no reporta tokens.
- `descubrir-reglas`: `claude-sonnet-4-5-20250929`, `max_tokens: 8192`, con `tool_choice` forzado. **Sí** guarda `tokens_input`, `tokens_output`, `costo_estimado_usd`, `tiempo_ms` en `regla_propuesta_run` (líneas 111-122). Esa tabla es la única referencia real de costo/latencia que existe en el proyecto para llamadas a Claude, pero es sobre payloads de texto — no comparable directo con PDF multimodal, que es más caro por página.

### 5. Veredicto de factibilidad

**Es extensión razonable, no integración desde cero.** Lo que ya existe cubre ~70%:

Ya está resuelto:
- Credencial `CLAUDE_API_KEY` en secretos.
- Patrón de llamada a `api.anthropic.com/v1/messages` con `tool_choice` forzado (`descubrir-reglas/index.ts:163-183`) — reutilizable tal cual, cambiando el schema del tool y el payload.
- Firma de URLs de bucket privado (`procesar-cancelacion/index.ts:1262`).
- Bus `credits:blocked` + `consume_credit_v2` para cobrar la acción nueva.

Lo que **falta construir**:
- Descarga del PDF firmado + codificación base64 dentro de la edge function (Deno) para armar el bloque `document` de Anthropic. No hay ningún edge function que lo haga hoy — todo el multimodal actual va contra Gemini vía gateway, no directo a Anthropic.
- Schema del tool `emit_verificacion` (probablemente `{ campo, valor_gemini, coincide: bool, cita_literal_pdf, confianza }` por cada campo verificado).
- Prompt notarial específico ("mira este PDF, ¿el apoderado se llama X con cédula Y? Cita textual").
- Precio en `credit_prices` (skill `pricing-creditos-sertuss` obligatorio antes de tocarlo — mem://index).
- Conexión con `detectRequiereRevisionManual` (mismo hook que se acaba de conectar para `_coherencia_warnings`) para que `coincide=false` con confianza alta dispare hard-block.
- Registro de tokens/costo (imitar `regla_propuesta_run`) para monitoreo real de gasto multimodal.

Riesgo mayor y no resuelto: **PDFs pesados**. Un certificado de tradición escaneado puede pasar de 5 MB; la Messages API limita PDF a 32 MB y 100 páginas por request, pero el costo escala con páginas. Habrá que decidir si mandamos el PDF entero o solo la(s) página(s) relevante(s) (p.ej. la carátula del poder para verificar identidad del apoderado). Hoy no tenemos código que sepa recortar páginas.

---

## Plan propuesto (a ejecutar solo tras aprobación)

Trabajo dividido en **3 hitos** para poder abortar entre uno y otro si el costo real no cierra.

### Hito 1 — Prueba de concepto acotada: identidad del apoderado en `poder_banco`

Un único campo de alto valor probatorio, un único documento fuente (el PDF del poder bancario), sin tocar el flujo en vivo todavía.

1. Nuevo edge function `verificar-con-claude` (misma cuarentena que `descubrir-reglas`: sin cron, invocable manualmente desde una acción admin en una cancelación existente).
2. Recibe `{ cancelacion_id }`. Lee `cancelaciones.data_ia->poder_banco->apoderado_nombre / apoderado_cedula` y el `expediente_files` correspondiente al poder.
3. Firma URL 30 min, descarga PDF, base64.
4. Llama a `claude-sonnet-4-5-20250929` con bloque `document` + tool `emit_verificacion_identidad` (schema: `{ nombre_coincide, cedula_coincide, cita_literal, confianza: "alta"|"media"|"baja" }`).
5. Guarda resultado en columna nueva `cancelaciones.claude_verificacion_poder jsonb` (migración con GRANTs). **No** dispara hard-block todavía — solo se muestra en UI admin de auditoría.
6. Registra `tokens_input/output/costo_usd/tiempo_ms` en tabla nueva `verificacion_run` (mismo modelo que `regla_propuesta_run`, con GRANTs y RLS solo authenticated + platform_admin).
7. Métrica de éxito antes de pasar a Hito 2: correr sobre las 7 cancelaciones ya marcadas + 20 aleatorias; medir tasa de "coincide=false" real y costo por corrida.

### Hito 2 — Ampliar a dirección de inmueble y cuantía

Solo si Hito 1 muestra tasa de detección útil (≥1 alucinación real detectada) y costo aceptable (<10¢ por documento).

1. Extender schema del tool a los 3 campos (identidad apoderado, dirección predio vs certificado tradición, cuantía vs escritura de hipoteca).
2. Se llama **una vez por documento fuente** (poder → identidad; certificado tradición → dirección; escritura hipoteca → cuantía), no una vez por campo. Máximo 3 llamadas por cancelación.
3. Sigue en modo "auditoría, no bloqueo".

### Hito 3 — Integración con hard-block

Solo tras aprobación explícita de un lote piloto revisado por Alejandra o dueño de producto.

1. Conectar `claude_verificacion_*.coincide === false && confianza === "alta"` con `detectRequiereRevisionManual` (mismo hook ya conectado para `_coherencia_warnings`).
2. Consultar skill `pricing-creditos-sertuss` para asignar precio en `credit_prices` (acción nueva `VERIFICACION_CLAUDE`), cobrar vía `consume_credit_v2`.
3. Botón UI en `PoderBannersV5.tsx` estilo "Verificar con IA independiente" opt-in, no automático en cada cancelación (control de costo).
4. Documentar en memoria (`mem://tech/verificacion-claude-multimodal`) que Claude ahora sí ve el PDF, pero solo en flujo bajo demanda, nunca síncrono con generación.

## Preguntas al usuario antes de codear

1. ¿Arrancamos por **Hito 1 completo** (identidad apoderado, sin bloqueo) o preferís aún más pequeño — literal un script one-shot en una edge que corra sobre 1 cancelación y devuelva el JSON en la respuesta, sin tabla nueva?
2. ¿PDF completo del poder o solo primera página? La segunda opción baja costo ~5x pero requiere agregar `pdf-lib` o similar a la edge (dependencia nueva).
3. Para el modelo: ¿mantenemos `claude-sonnet-4-5-20250929` (el que ya usa `descubrir-reglas`) o probamos con `claude-haiku` primero por costo? Haiku 3.5 sí acepta PDF y es ~5x más barato, pero puede fallar en cédulas manuscritas.