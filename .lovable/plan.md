# Rediseño semántico de `CUANTIA_DEDICADA_SYSTEM`

Aplica a `supabase/functions/procesar-cancelacion/index.ts` (prompt/tool, y los dos call-sites de telemetría `auto` y `reprocess_cuantia`). Sin migración de BD — solo `system_events.detalle` (JSONB) se enriquece.

## 1) Diagnóstico que ancla el diseño

- El anclaje sintáctico actual exige verbos rectores conjugados (`constituye/grava/…/entrega`). La construcción nominal `"PARA EFECTOS DE LIQUIDACIÓN, LA CUANTÍA DEL CRÉDITO OTORGADO ES: $X"` — fórmula estándar de carátula en escrituras 90s–2000s — falla por diseño.
- El único "éxito" histórico (`4b05d210`) coincide byte-a-byte con el ejemplo hardcodeado del prompt (`$8.558.475`) → sesgo por few-shot único.
- `fallo_ambiguo` colapsa tres estados distintos (sin evidencia, ambigüedad real, escritura declara abierta) sin registrar el texto candidato.

## 2) Nuevo prompt — enumerar → clasificar → desambiguar

Reemplaza `CUANTIA_DEDICADA_SYSTEM`:

```
Eres un sistema OCR jurídico-notarial colombiano. Tu única tarea es determinar
la CUANTÍA DEL CRÉDITO HIPOTECARIO (mutuo) documentada en una Escritura Pública
de Constitución de Hipoteca, cuando el Certificado de Tradición la registra
como "CUANTÍA INDETERMINADA / ABIERTA".

ALCANCE: hasta 30 páginas multimodales en un turno. La cifra puede estar en
carátula, cláusula de mutuo, cláusula de pago de la compraventa, casilla de
liquidación, o cualquier parte del cuerpo — recorre TODO.

PROCEDIMIENTO OBLIGATORIO:

PASO 1 — ENUMERAR
Lista TODAS las cifras monetarias en pesos colombianos ($) que veas, sin
filtrar. Para cada una captura el fragmento textual literal
(máx. ~140 caracteres alrededor de la cifra).

PASO 2 — CLASIFICAR
Para cada cifra, decide su rol SEGÚN EL CONTEXTO SEMÁNTICO (no por proximidad
a palabras clave). Clasifica en UNA:

  - "cuantia_credito"  → suma que el banco presta / concede / desembolsa /
                         entrega al deudor, O que la escritura llama
                         explícitamente cuantía del mutuo, valor del crédito,
                         monto del préstamo, cuantía del crédito otorgado, o
                         equivalente semántico (aunque el verbo no esté
                         conjugado — construcciones nominales cuentan).
  - "precio_venta"     → precio de compraventa del inmueble.
  - "avaluo"           → avalúo catastral o comercial.
  - "subrogacion"      → liberación / subrogación de gravamen previo.
  - "abono_saldo"      → abono, saldo pendiente, cuota inicial.
  - "subsidio"         → subsidio familiar, cesantías aplicadas.
  - "uvr_upac"         → cifra en UVR o UPAC (nunca cuantía principal).
  - "otro"             → honorarios, gastos notariales, impuestos, seguros.

PASO 3 — DESAMBIGUAR (elige UNA salida)

  a) Exactamente UNA cifra "cuantia_credito" → úsala. confianza = "alta".
  b) VARIAS "cuantia_credito" con MISMO monto normalizado → úsala. Confianza
     = "alta" (redundancia mutuo/pago/liquidación es esperada).
  c) VARIAS "cuantia_credito" con montos DISTINTOS irreconciliables →
     monto = null, motivo_null = "ambigua_multiple", confianza = "baja".
  d) CERO "cuantia_credito" pero escritura declara "HIPOTECA ABIERTA" /
     "SIN LÍMITE DE CUANTÍA" / "DE CUANTÍA INDETERMINADA" →
     monto = null, es_indeterminada = true,
     motivo_null = "escritura_declara_abierta", confianza = "alta".
  e) CERO "cuantia_credito" sin declaración de apertura →
     monto = null, motivo_null = "sin_evidencia", confianza = "baja".

FORMATO (solo casos a/b):
- valor_hipoteca_original = "<LETRAS MAYÚSCULAS> DE PESOS ($<NÚMEROS CON PUNTOS>)"
- valor_hipoteca_es_indeterminada = false
- motivo_null = null

ANTI-ALUCINACIÓN (LISTA NEGRA — estricto, INTACTA):
- NUNCA promuevas a "cuantia_credito" una cifra cuyo contexto la ubica en
  precio_venta / avaluo / subrogacion / abono_saldo / subsidio / uvr_upac / otro.
- NUNCA inventes cifras que no aparecen literalmente.
- NUNCA devuelvas "N/A", "ilegible", "?", "---" ni literales descriptivos.
- Si la cifra es ilegible, no la incluyas.

DEVUELVE SIEMPRE candidatos_vistos con TODAS las cifras del PASO 1.

EJEMPLOS:

Ej. 1 — MUTUO clásico (verbo conjugado):
  "…BANCO POPULAR S.A. concede al deudor un mutuo por la suma de VEINTICINCO
   MILLONES DE PESOS ($25.000.000) M/CTE, garantizado con hipoteca…"
  → valor = "VEINTICINCO MILLONES DE PESOS ($25.000.000)", motivo_null = null.

Ej. 2 — Construcción nominal de carátula (patrón nuevo 90s–2000s):
  "PARA EFECTOS DE LIQUIDACIÓN, LA CUANTÍA DEL CRÉDITO OTORGADO ES:
   $ 8.558.475.oo" + "precio de venta: $65.000.000" + "avalúo: $12.400.000".
  → valor = "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS
     SETENTA Y CINCO PESOS ($8.558.475)", motivo_null = null.
     candidatos_vistos incluye las 3 cifras clasificadas distinto.

Ej. 3 — Ambigüedad real irreconciliable:
  "cláusula sexta: el mutuo asciende a $50.000.000" + "cláusula décima:
   reliquidado el crédito, saldo insoluto $62.000.000".
  → valor = null, motivo_null = "ambigua_multiple", candidatos con ambas.

Llama SIEMPRE a la herramienta extract_cuantia_credito_dedicada.
```

## 3) Schema del tool (JSON Schema estricto)

```json
{
  "type": "object",
  "properties": {
    "valor_hipoteca_original": {
      "type": ["string", "null"],
      "description": "'<LETRAS> DE PESOS ($<NÚMEROS>)'. null si abierta/ambigua/sin evidencia."
    },
    "valor_hipoteca_es_indeterminada": { "type": "boolean" },
    "confianza": { "type": "string", "enum": ["alta","media","baja"] },
    "motivo_null": {
      "type": ["string","null"],
      "enum": ["sin_evidencia","ambigua_multiple","escritura_declara_abierta", null]
    },
    "candidatos_vistos": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "texto_fragmento": { "type": "string", "maxLength": 200 },
          "clasificacion": {
            "type": "string",
            "enum": ["cuantia_credito","precio_venta","avaluo","subrogacion",
                     "abono_saldo","subsidio","uvr_upac","otro"]
          },
          "monto": { "type": ["integer","null"] },
          "pagina_aprox": { "type": ["integer","null"] }
        },
        "required": ["texto_fragmento","clasificacion","monto"],
        "additionalProperties": false
      }
    }
  },
  "required": ["valor_hipoteca_original","valor_hipoteca_es_indeterminada",
               "motivo_null","candidatos_vistos"],
  "additionalProperties": false
}
```

Interfaces TS espejo:

```ts
type CuantiaMotivoNull = "sin_evidencia" | "ambigua_multiple" | "escritura_declara_abierta" | null;
type CuantiaClasificacion = "cuantia_credito"|"precio_venta"|"avaluo"|"subrogacion"|"abono_saldo"|"subsidio"|"uvr_upac"|"otro";
interface CuantiaCandidato {
  texto_fragmento: string;
  clasificacion: CuantiaClasificacion;
  monto: number | null;
  pagina_aprox?: number | null;
}
interface CuantiaDedicadaResult {
  valor_hipoteca_original: string | null;
  valor_hipoteca_es_indeterminada: boolean;
  confianza?: "alta"|"media"|"baja";
  motivo_null: CuantiaMotivoNull;
  candidatos_vistos: CuantiaCandidato[];
}
```

Nota: el proyecto usa JSON Schema en el tool-call (no Zod). Si se quiere validación runtime adicional con Zod antes del merge, se envuelve con `z.object({...})` — decisión aparte.

## 4) Telemetría enriquecida (`system_events.detalle`)

Helper `deriveCuantiaResultado(run)` reemplaza el balde único `fallo_ambiguo`:

```
- monto extraído ok                              → "exito"
- motivo_null === "escritura_declara_abierta"    → "indeterminada_confirmada"
- motivo_null === "ambigua_multiple"             → "fallo_ambiguo_multiple"
- motivo_null === "sin_evidencia"                → "fallo_sin_evidencia"
- error_status === 413 / "network" / "parse"     → fallo_413 / fallo_red / fallo_parse
- error_status numérico                          → `fallo_${n}`
- motivo_null ausente pese al schema             → "fallo_ambiguo_desconocido"
```

Helper `buildCuantiaExtra(run, trigger)` en ambos call-sites:

```ts
{
  trigger, paginas_totales, truncado, error_status, error_msg,
  motivo_null, confianza,
  candidatos_vistos,                        // ← nuevo
  candidatos_cuantia_credito_count,         // ← nuevo (derivado)
}
```

## 5) Alcance NO tocado (defensa en profundidad intacta)

- Lista negra semántica: intacta, ahora como enum de clasificación (más difícil de saltar).
- Contrato dos campos `valor_hipoteca_original` + `_es_indeterminada`: intacto. Skill `extraccion-cuantia-semantica` se cumple.
- `mergeCuantiaIntoExtracted`, precedencia manual > IA > BD, trigger `certIndet && escUrls.length > 0`: sin cambios.
- BD (`cancelaciones`): sin migración.

## 6) Plan de re-validación regresiva (previo al deploy)

Correr contra los 3 trámites cuyas páginas siguen en `<cancelacionId>/cancelaciones/soportes/escritura/*.jpg`.

| Caso | Estado hoy | Resultado esperado |
|---|---|---|
| `4b05d210` | éxito | mismo monto $8.558.475 — regresión-cero |
| `290fd66a` | fallo_ambiguo | monto real o `motivo_null` accionable |
| `2bef1db3` | fallo_ambiguo | ídem — caso que motiva el rediseño |

Mecánica: script Deno standalone `supabase/functions/procesar-cancelacion/_regression_cuantia.ts` (no edge function, solo `deno run` manual con `LOVABLE_API_KEY` + service_role). Para cada ID:

1. `storage.list(<prefix>)` — mismos paths de `reprocess_cuantia`.
2. `createSignedUrl` por página.
3. Llamar `extractCuantiaDedicada` reusada.
4. Imprimir a stdout: `motivo_null`, `confianza`, monto, `candidatos_vistos`.
5. NO escribe BD, NO consume créditos, NO llama `logCuantiaEvent`.

Umbral de aceptación:
- `4b05d210` → $8.558.475 exactos.
- Al menos uno de los otros dos pasa a "exito" o `motivo_null` accionable (no `fallo_ambiguo_desconocido`).
- Ninguno alucina cifras ausentes del PDF (verificación manual vs `candidatos_vistos`).

## 7) Pasos de implementación (cuando aprobado)

1. Reemplazar `CUANTIA_DEDICADA_SYSTEM` + `parameters` de `cuantiaDedicadaTool` + interfaces TS.
2. Añadir helpers `deriveCuantiaResultado` y `buildCuantiaExtra`; usarlos en los dos call-sites (`auto` y `reprocess_cuantia`).
3. Exportar `extractCuantiaDedicada`.
4. Crear `_regression_cuantia.ts`. Correrlo contra los 3 IDs; adjuntar output al ticket.
5. Solo si los 3 casos pasan el umbral, desplegar.
6. Vitest sin cambios (tests actuales cubren cirugías v2, no la cuantía).

## 8) Riesgos y mitigaciones

- **R1** `candidatos_vistos` obligatorio (~200–800 tokens extra). Mitigación: `maxLength: 200` en `texto_fragmento`.
- **R2** Gemini 2.5 Flash podría omitir `candidatos_vistos` cuando el ganador es obvio. Mitigación: `required` en schema + instrucción explícita; si aun así vacío, tool-call falla → cae en `fallo_parse` existente.
- **R3** Reclasificación `fallo_ambiguo` → 3 etiquetas rompería dashboards. Verificado: `rg` no encuentra consumidores externos del literal.
