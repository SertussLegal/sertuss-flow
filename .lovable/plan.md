# Diagnóstico — "Procesamiento no iniciado" en Sertuss

## Evidencia recolectada (solo lectura)

**Draft afectado:** `1ba4938f-e51c-4a5e-aefd-7c2d4f9924b5`, creado hoy 2026-07-07 16:36:26 UTC, `status='draft'`, `poder_adjuntado=false`, `escritura_antecedente_adjunta=false`.

- **Storage `expediente-files/1ba4938f%`: 0 objetos.** Ni el certificado llegó a subirse.
- **`edge_function_logs` de `procesar-cancelacion`:** sin entradas para ese id (nunca se invocó).
- **`system_events` últimos 30 min:** 0 filas.
- La cancelación previa exitosa es de 2026-07-06 — **antes** de los cambios de P1/P2 de hoy.

## Causa raíz (alta confianza)

El flujo de `CancelacionNueva.handleSubmit`:

1. `INSERT cancelaciones` → OK (por eso existe el draft huérfano).
2. `uploadPdfAsImages(cancelacionId, certificado, "certificado", 3)` → **throw aquí**.
3. `catch` externo ve `cancelacionId != null` y navega a `/cancelaciones/{id}/validar` con toast "Procesamiento interrumpido".
4. `CancelacionValidar` línea 653 detecta `status=draft && !data_ia` y renderiza la pantalla "Procesamiento no iniciado" que vio el usuario.

El throw viene de los **dos guardas forenses que P1 añadió a `src/lib/pdfToImages.ts`**:

- **`isCanvasUniform` (líneas 74-95, 137-139):** muestrea solo 5 píxeles fijos (centro + 4 cuadrantes internos). En un certificado de tradición con márgenes amplios o mucho blanco, los 5 puntos caen fácilmente en píxeles blancos idénticos → `EmptyCanvasError` → aborta.
- **`MIN_JPEG_BYTES = 3000` (línea 65, 156-161):** una página legítima con poco contenido (encabezado del certificado, última página con solo firma) puede generar JPEG <3 KB y también se rechaza.

Ambos guardas fueron pensados para detectar el bug histórico de "25 JPEGs uniformes" cuando `page.render` se resolvía sin pintar. Pero el heurístico es **demasiado estricto** cuando el render sí pinta contenido válido pero escaso.

## Alcance de la regresión

**No es aislado.** Le pasará a cualquier cancelación cuya primera página del certificado (o de la escritura) tenga muestreo uniforme en los 5 puntos o produzca JPEG <3 KB. Esto rompe el flujo antes de subir nada y antes de invocar la edge function — deja drafts huérfanos en BD y consume slots sin generar valor.

**No es un problema de red del usuario:** el patrón "0 uploads + 0 invocaciones + draft creado" es determinista dado un PDF que dispare el guarda.

## Plan de fix (P2b, pequeño y quirúrgico)

Todo dentro de `src/lib/pdfToImages.ts`. Sin tocar backend.

### 1. Relajar `isCanvasUniform`
- Cambiar de "5 puntos idénticos" a "80%+ de una grilla de 25 puntos son blancos O idénticos".
- Solo dispara `EmptyCanvasError` cuando la página está genuinamente en blanco, no cuando el muestreo tuvo mala suerte.
- Alternativa complementaria: aceptar `blob.size >= MIN_JPEG_BYTES` como señal de que el render sí pintó algo, aunque el muestreo dé uniforme.

### 2. Bajar `MIN_JPEG_BYTES`
- De 3000 → 1500 bytes. El bug histórico de placeholders producía ~12 KB idénticos entre páginas; el umbral solo necesita descartar canvas fantasma, no páginas escuetas.
- Consideración alterna más robusta: comparar **hash del JPEG entre páginas consecutivas** — si N páginas seguidas producen bytes idénticos, es el bug. Una sola página pequeña no lo es.

### 3. Downgrade de EmptyCanvasError a warning cuando `blob.size` es sano
- Si el canvas parece uniforme pero el JPEG pesa >`MIN_JPEG_BYTES`, `console.warn` y continúa. El bug real produce JPEGs pequeños Y uniformes al mismo tiempo.

### 4. Test de regresión
Añadir a `src/lib/pdfToImages.test.ts` un caso: canvas con contenido escaso (una firma en esquina, resto blanco) debe pasar sin lanzar `EmptyCanvasError`.

### 5. Limpieza del draft huérfano `1ba4938f`
Migración una-vez o `DELETE FROM cancelaciones WHERE id='1ba4938f-…'` (no bloqueante).

## Verificación

- `bunx vitest run` completo verde.
- Re-subir el mismo certificado que falló debe producir uploads a storage y una invocación real a `procesar-cancelacion`.
- Confirmar en `edge_function_logs` que la función ejecuta.

## Fuera de alcance de este fix

- No tocar el pre-check de páginas del Poder (P2, funciona correctamente — ese sí muestra toast bloqueante).
- No tocar la edge function.
- No tocar el flag `POWER_V6_EXTRACTOR_ENABLED` (sigue en `false`).
