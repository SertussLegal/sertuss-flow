Este plan es respuesta a una pregunta de investigación. No hay archivos a modificar; presento los hallazgos + opciones para que decidas.

## Respuestas con evidencia

### 1. ¿Existe un action de "re-extracción completa"?

**No hay un action con nombre dedicado.** Los `action` declarados en `procesar-cancelacion/index.ts` (línea 2361) son solo:
- `reprocess_poder` — re-extrae SOLO el Poder (línea 2575)
- `reprocess_cuantia` — re-extrae SOLO la cuantía del crédito (línea 2741)
- `confirm_manual_review` — no re-extrae, solo regenera docs desde `data_final` (línea 2488)
- `regression_cuantia` — batch de testing, no toca datos (línea 2381)

**PERO** el flujo por defecto (sin `action` y sin `regen`) sí ejecuta una re-extracción completa si le pasas `cancelacionId` + `certificadoImagePaths/escrituraImagePaths/poderImagePaths` de un trámite existente. En `index.ts:2445` desestructura esos parámetros, y en `index.ts:2929` (`MODO NORMAL: cobro + IA + docx + persistencia`) arranca Gemini contra las imágenes recibidas — **no hay guard de `status`** que impida hacerlo sobre un trámite `completed`.

### 2. ¿Sobrescribe data_ia/data_final o crea trámite nuevo?

**Sobrescribe la MISMA fila.** En `index.ts:3255` la persistencia final hace:
```
data_ia: cleanedExtracted,
data_final: cleanedExtracted,
```
sobre `cancelacionId`. Eso significa que **cualquier edición manual previa en `data_final` se pierde**. También sobrescribe `url_minuta_generada` / `url_certificado_generado` con los nuevos docs.

### 3. Costo real en créditos

`credit_prices` (consultado en vivo):
```
GENERACION_DOCX · cancelacion_hipoteca · 2 créditos · active
```
El cobro ocurre en `index.ts:2947` vía `consume_credit_v2` **antes** de llamar a Gemini. Costo IA subyacente (Gemini 2.5 Pro sobre ~33 imágenes) queda absorbido en esos 2 créditos — el precio al usuario final es fijo: **2 créditos**.

### 4. Alternativa: trámite nuevo con imágenes ya rasterizadas

Es viable y no requiere re-rasterizar:
- `CancelacionNueva.tsx` hoy rasteriza en cliente y sube a `expediente-files/{cancelacionId}/cancelaciones/soportes/{kind}/pNN.png`, luego invoca `procesar-cancelacion` con esos paths.
- La edge function acepta `certificadoImagePaths` como array de rutas de storage arbitrarias — no valida que estén bajo el `cancelacionId` recibido.
- Por tanto: crear un `cancelaciones` row nuevo (status `draft`) e invocar `procesar-cancelacion` pasándole los paths existentes `1c63c1aa-…/cancelaciones/soportes/certificado/p01-03.png` etc. dispararía la extracción sin re-rasterizar.
- Costo: también **2 créditos** (mismo `GENERACION_DOCX`).

## Opciones sobre la mesa (elige tú, no ejecuto nada)

| Opción | Efecto | Costo | Riesgo |
|---|---|---|---|
| **A. Re-invocar el flujo default sobre el mismo `cancelacionId`** con los `imagePaths` existentes | Sobrescribe `data_ia`/`data_final`/docs del trámite `1c63c1aa` | 2 créditos | Se pierde toda edición manual previa en `data_final` |
| **B. Crear un `cancelaciones` nuevo apuntando a los mismos paths de storage** | Trámite nuevo, el original queda intacto | 2 créditos | Ninguno — el original queda como respaldo comparable |
| **C. Añadir un `action: "reextract_full"` con guard explícito** que respalde `data_final` previo antes de sobrescribir | Requiere código nuevo | 2 créditos por corrida | Trabajo de dev + tests |

Mi recomendación por defecto es **B** para el caso puntual del trámite `1c63c1aa` (no destruye evidencia). Si esto va a ser recurrente, entonces **C** para dejarlo como capacidad de primera clase.

Confirma cuál (A / B / C) apruebas y cambio a modo build para ejecutarla.
