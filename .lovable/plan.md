# Antes de proponer el fix — necesito que elijas alcance

La investigación confirmó que el sistema hace lo que el prompt le dice y que el caso de hoy (`2bef1db3`) es un `fallo_ambiguo` genuino donde Gemini decidió que la escritura declara la hipoteca como "indeterminada". El fix de junio previene rechazo registral, pero no cubre la queja recurrente de Alejandra.

Hay tres alcances posibles. Sólo uno debería aprobarse como próximo paso.

## Opción A — Instrumentar primero, decidir después (bajo riesgo, 1 sesión)

**Qué**: enriquecer `system_events.procesar-cancelacion.cuantia` con lo que Gemini vio pero descartó:
- separar `fallo_ambiguo` en `sin_evidencia` / `ambigua_multiple` / `escritura_declara_abierta`
- pedirle al extractor un campo opcional `motivo_null` (enum) y `candidatos_vistos` (array de cifras con contexto corto)
- agregar en `detalle` el páginas donde estaba la cláusula candidata
- botón en Admin (o CLI) para re-correr el extractor sobre un trámite específico con logging verbose

**Salida**: en 1–2 semanas tendremos evidencia real de cuál es la causa dominante y podremos elegir B o C con datos, no con corazonadas.

**Costo**: bajo. No cambia el comportamiento del usuario. No arriesga regresiones. Consume tokens extra en el `detalle` (marginal).

## Opción B — Señales cruzadas + fallback más agresivo (medio, 2–3 sesiones)

**Qué**: usar lo que ya se extrajo en el mismo trámite:
- si el poder del banco menciona un monto (o "cupo máximo garantizado"), usarlo como hint para el extractor dedicado
- segundo intento del extractor con prompt relajado ("si la escritura declara abierta pero menciona un monto máximo garantizado, devuélvelo con `cuantia_origen=cupo_maximo`")
- exponer en UI la distinción "abierta genuina" vs "abierta con cupo" para que Alejandra confirme

**Riesgo**: la fila "abierta genuina" es legalmente distinta de "abierta con cupo" — meter el cupo como cuantía puede reintroducir el problema de rechazo registral que el fix de junio resolvió. Requiere validación legal explícita con Alejandra antes de tocar prompt.

## Opción C — Reprocess-cuantía manual mejorado en UI (medio, 1–2 sesiones)

**Qué**: el endpoint `action=reprocess_cuantia` ya existe (línea 1837). Falta:
- botón visible en la UI de la cancelación cuando `valor_hipoteca_es_indeterminada=true`
- permitir al usuario adjuntar páginas específicas de la escritura (no todo el PDF)
- mostrar candidatos que Gemini vio y dejar que el humano elija

**Ventaja**: no toca el auto-flow, no arriesga regresión, empodera al humano. Requiere UI nueva.

---

## Recomendación

Empezar por **A** (instrumentar). Sin datos del `motivo_null` y de los `candidatos_vistos` reales de los próximos 5–10 casos de Alejandra, cualquier fix en B o C es adivinar. El caso de hoy ya se perdió — no podemos recuperar qué vio Gemini en `2bef1db3` sin re-correr con logging enriquecido, y aun así perdimos el estado exacto del prompt de esa corrida.

**Confírmame cuál de las tres opciones apruebas (o si prefieres A + C combinadas) y armo el plan detallado de implementación.**
