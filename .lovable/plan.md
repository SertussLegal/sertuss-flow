# Diagnóstico — Estimación de costo IA por trámite

**Aviso:** no hay telemetría de tokens en el sistema. Los números son **estimaciones** basadas en tamaño de prompts en el código (÷4 caracteres = 1 token) y supuestos de un trámite típico. Precios de referencia (nov-2025): Gemini 2.5 Flash ≈ $0.30/1M in, $2.50/1M out; Gemini 2.5 Pro ≈ $1.25/1M in (≤200k), $10/1M out; Claude Sonnet 4 ≈ $3/1M in, $15/1M out. Imágenes en Gemini: ~258 tokens/tile de 768px; con `maxDimension=1600` en `pdfToImages` → ~4 tiles ≈ **1.000 tokens/imagen**.

---

## 1) Flujo ESCRITURA (compraventa + hipoteca)

### 1a. `scan-document` — Gemini 2.5 Flash (una llamada por documento subido)

Un trámite típico envía 6 documentos:

| Documento | Prompt (chars → tokens) | Imgs típicas | Img tokens | Tool schema aprox. | Out (JSON) |
|---|---|---|---|---|---|
| Cédula comprador (front+back) | 615 → 154 | 2 | 2.000 | ~400 | ~300 |
| Cédula vendedor (front+back) | 615 → 154 | 2 | 2.000 | ~400 | ~300 |
| Certificado tradición | 13.865 → 3.466 | 5 | 5.000 | ~1.500 | ~1.500 |
| Predial | 2.439 → 610 | 2 | 2.000 | ~600 | ~500 |
| Escritura antecedente | 3.323 → 830 | 10 | 10.000 | ~800 | ~2.000 |
| Poder banco (hipoteca) | 9.063 → 2.266 | 3 | 3.000 | ~1.200 | ~1.000 |
| Carta crédito (hipoteca) | 413 → 103 | 2 | 2.000 | ~300 | ~200 |

**Subtotal scan-document (7 llamadas):**
- Input ≈ **41.800 tokens** (7.600 texto + 26.000 imágenes + 5.200 schemas + STRICT_OUTPUT_RULES ~3.000)
- Output ≈ **5.800 tokens**

### 1b. `process-expediente` — Gemini 2.5 Pro (1 llamada)

- systemPrompt (`buildEditorProPrompt`) ≈ 2.500 chars → **~625 tokens**
- userPrompt = `JSON.stringify(superJson) + prosaHelpers + notariaBlock`. superJson trae todos los datos extraídos + campos formulario. Estimado **8.000–12.000 tokens** para un trámite completo con 2 personas + inmueble + hipoteca.
- Tool schema `redactar_escritura` ≈ **~400 tokens**
- **Input ≈ 11.000 tokens**
- Output: escritura HTML completa + sugerencias_ia. Escrituras típicas 8–15 páginas → **~7.000 tokens output**

### 1c. `validar-con-claude` — Claude Sonnet 4 (1 llamada)

- systemPrompt dinámico (reglas + configNotaria + plantilla) ≈ **~4.000 tokens**
- Datos extraídos + texto_preview ≈ **~5.000 tokens**
- `max_tokens: 4096` → output real ~1.500–3.000 tokens

**Subtotal Claude:** ~9.000 in / ~2.500 out

---

## 2) Flujo CANCELACIÓN DE HIPOTECA (Davivienda)

`procesar-cancelacion` hace **3 llamadas en paralelo**:

| # | Modelo | Prompt (chars → tokens) | Imgs | Img tokens | Out |
|---|---|---|---|---|---|
| 1 | gemini-2.5-**pro** (monolítico: cert + escritura + poder) | 32.737 → **~8.200** | ~12 (5 cert + 5 escritura + 2 poder) | 12.000 | ~2.500 |
| 2 | gemini-2.5-flash (poder dedicado) | 8.107 → **~2.030** | 3 | 3.000 | ~500 |
| 3 | gemini-2.5-flash (cuantía dedicada) | 4.887 → **~1.220** | 3–5 (escritura hipoteca) | 4.000 | ~300 |

Nota: `scan-document` **no se invoca** en cancelaciones — el pipeline es dedicado.

---

## 3) `validar-con-claude`

Se invoca desde `Validacion.tsx` (flujo escritura). En cancelaciones **no aparece** invocado desde `CancelacionValidar.tsx` — verificado en el diagnóstico anterior de créditos (Claude declarado como acción pero nunca cobrado). Típicamente 1 vez por trámite escritura al pulsar validar.

---

## 4) Tabla resumen

### Trámite ESCRITURA compraventa+hipoteca

| Etapa | Modelo | # llamadas | In tokens | Out tokens | Costo USD |
|---|---|---:|---:|---:|---:|
| scan-document | Gemini 2.5 Flash | 7 | 41.800 | 5.800 | $0.027 |
| process-expediente | Gemini 2.5 Pro | 1 | 11.000 | 7.000 | $0.084 |
| validar-con-claude | Claude Sonnet 4 | 1 | 9.000 | 2.500 | $0.065 |
| **TOTAL** | | **9** | **~61.800** | **~15.300** | **~$0.18** |

### Trámite CANCELACIÓN Davivienda

| Etapa | Modelo | # llamadas | In tokens | Out tokens | Costo USD |
|---|---|---:|---:|---:|---:|
| Monolítico | Gemini 2.5 Pro | 1 | 20.200 | 2.500 | $0.050 |
| Poder dedicado | Gemini 2.5 Flash | 1 | 5.030 | 500 | $0.003 |
| Cuantía dedicada | Gemini 2.5 Flash | 1 | 5.220 | 300 | $0.002 |
| **TOTAL** | | **3** | **~30.450** | **~3.300** | **~$0.055** |

---

## Observaciones

- **Escritura ≈ 3× más cara que cancelación** por: (a) muchas llamadas scan-document individuales, (b) llamada Pro con contexto grande + salida larga, (c) Claude Sonnet 4 (el modelo más caro por token de esta lista).
- **Precio actual (2 créditos = generación docx, 1 crédito = OCR):** si 1 crédito ≈ $X COP, con estos costos crudos Sertuss puede fijar el crédito con margen holgado. Un trámite escritura completo (7 OCR × 1 + 2 apertura = 9 créditos) cuesta ~$0.18 USD ≈ $750 COP en costo IA.
- **Sensibilidad:** el número real varía ±40% según nº de páginas del certificado de tradición y de la escritura antecedente (los dos "gordos" del pipeline).
- **Sin telemetría real** no hay forma de auditar deriva de costos cuando cambien prompts o modelos. Vale la pena considerar loggear `usage.prompt_tokens`/`completion_tokens` que ya devuelve el gateway.

**No se ejecutó ninguna llamada real a IA. No se modificó ningún archivo.**
