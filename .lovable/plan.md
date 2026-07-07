
# Análisis: implicaciones reales de encender `POWER_V5_ENABLED`

**Conclusión ejecutiva:** encender la flag hoy, sola, **no arregla el caso de Alejandra**. Cambia mucho menos de lo que el nombre sugiere: no cambia el prompt, no activa el schema v6 en cancelaciones, y no toca el rasterizador. Los problemas reales (truncado a 25 páginas, JPEGs uniformes, schema plano en cancelaciones) viven fuera del alcance de esta flag.

---

## 1. Qué cambia exactamente al activar la flag

Hay **dos flags distintas con el mismo nombre**, y una **tercera pieza (v6)** que no depende de ninguna:

| Flag | Ubicación | Default hoy | Qué controla |
|---|---|---|---|
| `POWER_V5_ENABLED` (edge) | `supabase/functions/_shared/poderBancoSchemaVersion.ts` (env Deno) | **false** | (a) cachear OCR del poder en `ocr_raw_cache`; (b) seleccionar `TEMPLATE_MINUTA_V3` si `data.poder_banco.apoderado.tipo` está poblado |
| `VITE_POWER_V5_ENABLED` (client) | `src/lib/featureFlags.ts` | **true** | Mostrar `PoderBannersV5` y modal de prosa apoderado en `CancelacionValidar.tsx` |
| Schema v6 (`poder_banco_v6`) | `scan-document/core/poderBanco/tool.ts` | siempre activo | Usado por `scan-document` (llamado desde `Validacion.tsx` en tramites, **no** en cancelaciones) |

**Camino "flag apagada" (hoy en cancelaciones):**
1. `procesar-cancelacion` corre monolítico Gemini 2.5 Pro (cert + escr + poder juntos).
2. En paralelo corre `extractPoderBancoDedicado` con **schema plano legacy** (5 campos: nombre, cédula, escritura, fecha, notaría). Gemini 2.5 Flash, una sola llamada multimodal con todas las páginas del poder.
3. Merge Read-then-Merge y persiste.

**Camino "flag encendida" (edge) en cancelaciones:**
1. Igual monolítico.
2. Igual `extractPoderBancoDedicado` con el **mismo schema plano** — **el prompt no cambia**.
3. Único delta real: el resultado del extractor dedicado pasa por `runWithPoderCache` (`ocr_raw_cache` por SHA-256 del PDF). Hit → 0 llamadas a Gemini. Miss → misma llamada que hoy + INSERT en caché.
4. `selectMinutaTemplate` **intentaría** usar `TEMPLATE_MINUTA_V3`, pero el extractor plano **jamás** puebla `apoderado.tipo`, así que **v3 nunca se activa desde este flujo**. En la práctica se queda en v2.

**Compatibilidad de datos con `CancelacionValidar.tsx`:** ninguna forma de datos cambia. La flag no altera el shape de `data.poder_banco`.

---

## 2. ¿El pipeline v6 fue probado alguna vez?

- **Tests unitarios que ejerciten `runWithPoderCache` end-to-end con un PDF real: 0.** No existen.
- Tests relacionados encontrados: `validatePoderSuficiencia_test.ts` (valida sufuciencia de datos, no el extractor), `apoderadoClassifier.test.ts` (clasifica payloads ya extraídos), contract tests de prosa (Davivienda) — todos operan sobre **inputs sintéticos**, ninguno invoca Gemini ni prueba el flujo cacheado.
- Evidencia en BD (verificación previa): `ocr_raw_cache` tiene **0 filas**. Nunca se ha escrito una entrada v6 en producción.
- Las 2 únicas cancelaciones con `poder_banco` en BD usan **schema plano legacy**, no v6.

**Riesgo:** encender la flag activaría por primera vez `runWithPoderCache` en producción con tráfico real. El código tiene `try/catch` degradantes ("si la caché falla, corre el extractor sin caché") — es defensivo, pero nunca se ejerció con carga.

---

## 3. Bug de los JPEGs uniformes (12.192 bytes) — ¿lo arregla la flag?

**No.** El bug (si es bug) vive en `src/lib/pdfToImages.ts`, **cliente, antes de subir**. La flag actúa sobre el extractor edge que consume los JPEGs ya subidos. Si las páginas llegan degradadas al bucket, activar la caché solo **memoriza el mismo output pobre** por SHA — empeora, no mejora.

Observación adicional: `pdfToImages` renderiza a `maxDimension = 1600` con `jpegQuality = 0.75`. 12.192 bytes exactos por 25 páginas sugiere **canvas colapsado a placeholder** (posiblemente `canvas.width = 0` disparado antes de tiempo, o `page.render` fallando silenciosamente antes de `toBlob`). Requiere investigación aparte, independiente de la flag.

---

## 4. Costo incremental de activar v5

Por poder procesado en cancelaciones:

| Escenario | Llamadas Gemini adicionales | Costo delta |
|---|---|---|
| Miss (primera vez este PDF) | **0** (misma llamada que hoy) | +1 INSERT en `ocr_raw_cache` |
| Hit (mismo PDF reprocesado) | **-1** (ahorra 2.5 Flash multipágina) | -~$0.001–0.005 USD según páginas |

**Neto: costo baja levemente o queda igual.** No aplica análisis del skill `pricing-creditos-sertuss` porque no hay acción monetizable nueva ni cambio en `credit_prices` — el precio de la cancelación no depende de esto.

---

## 5. Rollout: ¿hay flag por organización?

**No.** Es una env var global de la edge function (`Deno.env.get("POWER_V5_ENABLED")`). Todo o nada, para todos los tenants a la vez.

Alternativas si se quiere rollout acotado (no incluidas hoy, solo mencionadas):
- Gate por `organizationId` dentro del código (parche menor).
- Gate por `debug_tools_enabled` en `organizations` (ya existe).

---

## 6. Plan de rollback

**Rápido y seguro:**
- Desactivar env var y redeploy edge → vuelve al camino legacy en segundos.
- Datos en `ocr_raw_cache` quedan como registros huérfanos inofensivos (nunca se leen si la flag está off).
- Cancelaciones procesadas mientras estuvo encendida quedan **idénticas** a las del camino legacy (el shape de `data.poder_banco` no cambia — solo se cacheó el resultado).

**Sin efectos de largo plazo, sin datos corruptos, sin migración inversa.**

---

## 7. ¿Resuelve el caso original de Alejandra?

**No, y hay que ser explícito sobre por qué.** El caso original: poder de 25+ páginas donde la cláusula de designación está al final y el sistema devolvió `poder_banco` vacío.

Lo que la flag **no** arregla:

1. **Truncado a 25 páginas en el cliente:** `CancelacionNueva.tsx` tiene `PODER_MAX_PAGES = 25` hardcodeado. Si el poder de Alejandra tenía más páginas, esas simplemente **no se suben**. La flag opera río abajo.
2. **JPEGs uniformes de 12.192 bytes:** ya subidos así al bucket. La flag procesa lo que hay; si son placeholders, extrae nada. Cachearía "nada".
3. **Schema plano en cancelaciones:** `procesar-cancelacion` usa `extractPoderBancoDedicado` con **5 campos legacy**, no el schema v6 profundo. El schema v6 (`apoderados[]`, `total_paginas`, `schema_version`, cadena poderdante→apoderado→instrumento) **solo existe en `scan-document`**, que **no** se llama desde el flujo de cancelaciones. El fix supuesto del "poder que no se leyó" (B3) requiere **cablear el extractor v6 dentro de procesar-cancelacion** — trabajo que **no está hecho**.
4. **Template v3 nunca se dispara:** aunque la flag esté encendida, `apoderado.tipo` nunca se puebla desde el extractor plano actual → siempre cae en v2.

**Lo que sí haría la flag para Alejandra:** ahorrarnos una llamada a Gemini si reprocesa el mismo PDF. Nada más.

---

## Recomendación (no ejecutable, solo análisis)

**No encender la flag como solución al caso de Alejandra.** Antes de activarla, decidir el orden real de arreglos:

- **P1 (crítico, bloqueante):** investigar el bug de JPEGs uniformes en `pdfToImages`. Sin PDFs bien rasterizados, ningún extractor funciona.
- **P2 (alto):** subir o eliminar `PODER_MAX_PAGES = 25` (paginar en subida, o cambiar el pipeline para leer el PDF completo del bucket).
- **P3 (alto):** cablear el extractor v6 de `scan-document/core/poderBanco` **dentro de** `procesar-cancelacion` (o llamarlo como sub-invoke), para que `data.poder_banco.apoderado.tipo` se pueble y `TEMPLATE_MINUTA_V3` tenga sentido.
- **P4 (medio):** una vez P1–P3 estén hechos y probados con el PDF real de Alejandra, entonces encender `POWER_V5_ENABLED` como optimización de costo (caché).
- **P5 (opcional, higiene):** re-alinear el nombre — hoy conviven `POWER_V5_ENABLED` (edge), `VITE_POWER_V5_ENABLED` (client, default true), y `POWER_SCHEMA_VERSION = poder_banco_v6`. Nombres confusos, riesgo de decisiones equivocadas futuras.

Cualquier otra ruta (encender la flag y esperar que arregle a Alejandra) sería, con la evidencia actual, **teatro de seguridad de producto**.
