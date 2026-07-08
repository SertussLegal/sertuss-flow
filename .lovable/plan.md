
# Auditoría — Grounding check (anclaje textual) para `poder_banco` y `nomenclatura_predio`

Reporte de investigación previo a diseño. No hay cambios propuestos aún; primero cerramos las 5 preguntas con evidencia concreta.

## 1) ¿Existe texto OCR crudo en el pipeline de `procesar-cancelacion`?

**No. El texto OCR crudo nunca existe en el pipeline.** Gemini se llama con **tool calling** (function calling), no en modo texto libre. Lo que devuelve es directamente el JSON estructurado del schema, no una transcripción del PDF.

Evidencia:
- `supabase/functions/scan-document/shared/runGemini.ts` y todos los handlers (`core/certificadoTradicion/handler.ts:5-14`, `core/poderBanco/handler.ts`, `core/escrituraAntecedente/handler.ts`) invocan `runGemini({ tools, toolName })` y retornan `ExtractedJson`. Nunca capturan la respuesta textual del modelo.
- La caché `ocr_raw_cache` guarda `raw_payload` = **el JSON estructurado ya extraído**, no el texto (`supabase/functions/_shared/poderBancoCache.ts:107-149`). El nombre "raw" es engañoso: es "raw payload de la extracción", no "raw text del PDF".
- Búsqueda exhaustiva de identificadores tipo `raw_text|ocr_text|full_response|response_text|texto_extraido` en `supabase/functions/`: **cero resultados**.
- Lo único que persiste el pipeline aguas abajo son los PDFs originales en el bucket `expediente-files` y las imágenes JPEG derivadas para el SHA-256 (`_shared/pdfSha256.ts`).

**Consecuencia:** hoy no hay dónde comparar. Para hacer grounding textual habría que **añadir una etapa de OCR-a-texto** (segunda pasada con Gemini en modo texto, o Tesseract/Google Vision, o simplemente pedirle a Gemini un campo `_texto_literal_fuente` dentro del mismo tool call) o **cachear la respuesta cruda de Gemini** en paralelo al JSON.

## 2) `_coherencia_warnings` vs `revision_manual_requerida`

Están **desconectados por diseño hoy**.

- Warnings se generan en `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts::validatePoderBancoCoherencia` (reglas puras sobre el JSON mergeado: escritura incoherente, año incoherente, formato de cédula inválido, apoderado colapsado con RL, NO_LEGIBLE en campos críticos).
- Se anotan sobre el objeto mergeado en `procesar-cancelacion/index.ts:1374-1400 (annotatePoderCoherencia)`, invocado desde las líneas `2180` y `2580`. Además emiten un `system_events` no bloqueante.
- El hard-block de Fase E lo decide **otra función independiente**: `detectRequiereRevisionManual(extracted)` en `procesar-cancelacion/index.ts:1216-1236`, llamada en `2689`. Solo mira si los 6 paths críticos contienen el string literal `"NO_LEGIBLE"`. **No consulta `_coherencia_warnings`.**
- Resultado: los warnings de coherencia (los que sí detectan alucinación por incoherencia interna, no ilegibilidad admitida) **nunca disparan `status = requiere_revision_manual`**. Solo pintan chips en la UI (`src/pages/CancelacionValidar.tsx:1161-1163`).

Esa es la brecha exacta que abre el caso de la matrícula 50S-40394832: el poder era coherente consigo mismo (Gemini alucinó de forma auto-consistente), así que ni `validatePoderBancoCoherencia` ni `detectRequiereRevisionManual` dispararon.

## 3) Regla "índice más alto" para `nomenclatura_predio`

Vive **solo en el prompt**, no en código determinista:
- `procesar-cancelacion/index.ts:209` (schema description) y `:322` (SYSTEM_PROMPT bloque a).
- `scan-document/core/certificadoTradicion/prompt.ts:17` y `tool.ts:32` (flujo del escaneo individual).

El post-procesado determinista (`buildDireccionCompletaSaneada` en `procesar-cancelacion/index.ts:667`, invocado en `:953`) **asume que `nomenclatura_predio` ya viene correcto** y solo sanea complementos/ciudad. No re-audita el renglón elegido.

Y como en el punto 1: **en ese momento el texto crudo del certificado no existe** en memoria. Solo está el JSON `data.inmueble.nomenclatura_predio`. No hay contra qué contrastar.

## 4) Auditoría retrospectiva — mismo nombre, cédulas distintas

Consulta sobre las 11 cancelaciones con `data_ia->poder_banco` no vacío:

| Nombre | Cédulas distintas | Valores |
|---|---:|---|
| **ANA MARIA MONTOYA ECHEVERRY** | **5** | `41525143`, `41944755`, `521639-4`, `79.123.456`, `NO_LEGIBLE` |
| FELIX DE JESUS CAGUA | 1 | `79.123.456` |
| FELIX REUZE CAÑAS | 1 | `19.345.545` |
| MARIA CAMILA PEÑA RAMÍREZ | 1 | `101.846.520` |
| MARIA FERNANDA PINZON ALVARADO | 1 | `52310103` |

Hallazgos concretos:
- **"Ana María Montoya Echeverry" aparece con 5 cédulas distintas en 5 cancelaciones**, incluida `79.123.456` (número plantilla clásico de "cédula falsa de ejemplo") y `41.939.243` **no aparece** entre las 5 (la real conocida del caso auditado ayer estaba como `NO_LEGIBLE`).
- El valor `79.123.456` se comparte además con "FELIX DE JESUS CAGUA": una misma cédula falsa aparece asignada a dos personas distintas.
- Formatos incoherentes en el mismo campo: con puntos, sin puntos, con guion, y hasta el sentinel `NO_LEGIBLE`. `validatePoderBancoCoherencia` sí marca el guion como formato inválido, pero **no cruza contra otras filas** — cada extracción se valida en aislamiento.

Esto confirma la premisa del caso: la alucinación no es un evento aislado, es un patrón. Un chequeo de "esta cédula ya aparece asignada a otro nombre" o "este nombre ya apareció con cédula distinta" sería detectable **hoy con SQL** sin necesidad de OCR crudo.

## 5) Veredicto sobre construir el grounding check ahora

**Complejidad honesta:**
- Grounding **puro** (comparar valor final contra texto OCR crudo del documento fuente): **no es simple**. Requiere primero decidir cómo obtener el texto crudo — hoy no existe en ningún lado del pipeline (punto 1). Opciones ordenadas por costo:
  1. Añadir un campo `_texto_literal_fragmento` al schema del tool para que Gemini devuelva la frase exacta donde vio cada dato crítico (nombre, cédula, escritura, nomenclatura). Costo: bajo, misma llamada, cero infraestructura nueva. Riesgo: la IA también puede alucinar la "cita".
  2. Segunda pasada Gemini en modo texto libre (transcripción del PDF) cacheada en `ocr_raw_cache` como `raw_text`. Costo: +1 llamada por documento, +1 columna, +tokens.
  3. OCR determinista externo (Tesseract/Google Vision) que sí sea "fuente independiente" de Gemini. Costo: infraestructura nueva.
- Grounding **estadístico** (detectar patrones tipo "mismo nombre con cédulas distintas entre cancelaciones", "cédula duplicada entre nombres distintos", "cédula = valor plantilla `79.123.456`"): **sí es simple hoy**. Los datos ya están estructurados en `cancelaciones.data_ia`, se puede hacer con SQL o dentro de `annotatePoderCoherencia` con un extra query. No requiere tocar el OCR.
- Conectar `_coherencia_warnings` a `detectRequiereRevisionManual` (que warnings críticos ya SÍ bloqueen): **trivial**, un edit en `index.ts:2689`. Independiente del grounding, y solo ese cambio ya hubiera bloqueado 3 de las 5 filas anómalas de Ana María.

**Recomendación de secuencia** (para discutir antes de codear nada):
1. **Cheap win primero:** promover un subconjunto de `_coherencia_warnings` a bloqueantes (fusionar con Fase E). Cierra el gap descrito en el punto 2 sin infraestructura nueva.
2. **Grounding estadístico cross-cancelación:** función determinista que consulte duplicidad de nombre↔cédula y cédulas tipo plantilla. Costo bajo, alto valor probatorio, y ya tiene datos históricos que lo justifican (punto 4).
3. **Grounding textual real (0.2/0.3):** decidir entre opción (a) `_texto_literal_fragmento` en el mismo tool call o (b) segunda pasada de transcripción cacheada. Esto es el trabajo mayor y merece su propio plan aparte.

## Preguntas abiertas para el usuario antes de escribir un plan de implementación

- ¿Quieres que el próximo plan cubra **solo el paso 1** (conectar warnings ↔ hard-block, ganancia inmediata) o los pasos 1+2 juntos?
- Para el grounding textual real (paso 3), ¿prefieres explorar primero la opción (a) `_texto_literal_fragmento` (barata, misma llamada, pero misma IA como juez y parte) o pedir un OCR determinista externo (más caro, verdadera fuente independiente)?
