## Diagnóstico con evidencia (a8af7200)

**Estado real del row (psql, 02:xx UTC):**
- `status = requiere_revision_manual`
- `revision_manual_requerida = true`
- `error_message = NULL`
- `data_ia` y `data_final` **poblados**
- `url_minuta_generada = NULL`, `url_certificado_generado = NULL`
- `updated_at = 02:01:04Z` (autosave silencioso)

**Motivos del bloqueo (system_events + activity_logs, 01:57:30Z):**
```
inmueble_direccion_menciones_incoherentes
inmueble_matricula_menciones_incoherentes
```
Ambos son del CERTIFICADO (no del poder). Vienen de menciones divergentes leídas en distintas secciones del PDF. `poder_banco._coherencia_warnings = []`.

**Edge Function `procesar-cancelacion`:** sin logs nuevos para este trámite en los últimos 45 min. Es decir: **el "Guardando…" que ve Alejandra NO llega al servidor.** No hay 5xx, no hay 504, no hay timeout — el frontend está gastando 1500 ms locales en ciclos de autosave que no invocan nada útil.

**Pipeline sano:**
- `procesar-cancelacion.poder = exito` (v6 fulfilled, 20 páginas, 12 campos).
- `procesar-cancelacion.cuantia = no_aplica` (esperado, hipoteca no marca cuantía en cert).
- `procesar-cancelacion.inmueble.coherencia = warnings` (los 2 arriba).
- `procesar-cancelacion.revision_manual = bloqueado`.

## Causa raíz del síntoma visual

Es exactamente el bug P0 que arreglamos en este turno (`persistData` con `regen: true` chocando contra `ManualReviewRequiredError`). Los tres badges simultáneos son coherentes con eso:

- **"Guardando…"** — chip del autosave que sí escribe fila cancelaciones sin problema.
- **"Vista desactualizada"** — flag `previewStale=true` seteado cuando falla el regen 409.
- **"Documento actualizado"** — chip antiguo que refleja el último save exitoso a la tabla.

Los tres son de subsistemas distintos, no se contradicen.

## Instrucción INMEDIATA para Alejandra (funciona con el prod actual, sin deploy)

1. En el formulario derecho, hacer **scroll hasta la sección "Apoderado del Banco (Poder General)"**.
2. Al inicio de ese bloque, encima de los campos, hay un banner con el botón **"Confirmar revisión manual y generar"** (componente `PoderBannersV5`).
3. Antes de pulsar: verificar en el bloque **Inmueble** que `Dirección` y `Matrícula` están correctas — los valores que ella ya editó **sí están guardados en BD** (`updated_at` cambió).
4. Pulsar el botón. Eso aplica `MANUAL_OVERRIDE_RULES` en el backend, salta el hard-block y genera minuta + certificado. Toma 15-30 s.

No refrescar la página ni reintentar carga: mantiene el mismo estado y no ayuda.

## Estado del fix ya escrito en este turno (aún no desplegado)

El fix aplicado incluye:
- Banner sticky ámbar al tope de `CancelacionValidar.tsx` con el mismo CTA y lista de motivos, para que la próxima usuaria no tenga que scrollear.
- `persistData` saltea `regen` cuando `status=requiere_revision_manual` → elimina el loop de 409 y el "Guardando…" permanente.
- `SaveStatusChip` con estado "Revisión manual pendiente" explícito en vez de "Guardando…".

Recomendación: **publicar el fix ya**, así Alejandra (y cualquiera que caiga en el mismo estado) ve el CTA al tope. La invocación de "Confirmar revisión manual y generar" del prod actual sigue funcionando, así que el fix es puramente UX.

## Qué NO hay que hacer

- Reprocesar el trámite: `data_ia`/`data_final` están completos y correctos; una re-extracción cobra créditos y podría volver a producir los mismos warnings.
- Editar en BD directo el status: el generador docx se dispara sólo dentro del flujo `confirm_manual_review`; forzar `completed` sin generar deja el row huérfano.

## Confirmación pedida

¿Publicamos el fix ya en modo build (`preview_ui--publish`) para que Alejandra vea el banner sticky al recargar, o preferís que primero le dicte los pasos manuales del prod actual y publicamos después?
