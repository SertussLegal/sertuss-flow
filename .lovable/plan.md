
# Rediseño de CUANTIA_DEDICADA_SYSTEM — enfoque semántico type-safe

Aplica a `supabase/functions/procesar-cancelacion/index.ts` (líneas 1389-1465 del prompt/tool, 2216-2244 de la telemetría) y al modo `reprocess_cuantia` existente (línea 1641, 1831). Sin cambios de esquema de BD — solo `system_events.detalle` se enriquece (JSONB, ya soporta claves nuevas).

## Diagnóstico que ancla el diseño

- El anclaje sintáctico actual exige verbos rectores conjugados (`constituye/grava/…/entrega`). La construcción nominal `"la cuantía del crédito otorgado es: $X"` — fórmula estándar de carátula en escrituras 90s–2000s — falla por diseño.
- El único "éxito" en telemetría (`4b05d210…`) coincide byte-a-byte con el ejemplo hardcodeado del prompt (`$8.558.475`), lo que sugiere sesgo por few-shot único.
- `fallo_ambiguo` colapsa tres estados semánticos distintos (sin evidencia, ambigüedad real, escritura declara abierta) en una etiqueta, sin registrar el texto candidato que vio Gemini.

## 1) Nuevo prompt — enumerar → clasificar → desambiguar

Reemplaza `CUANTIA_DEDICADA_SYSTEM` (líneas 1419-1450). El modelo pasa de "buscar patrón fijo" a razonar en tres pasos:

```
Eres un sistema OCR jurídico-notarial colombiano. Tu única tarea es determinar
la CUANTÍA DEL CRÉDITO HIPOTECARIO (mutuo) documentada en una Escritura Pública
de Constitución de Hipoteca, cuando el Certificado de Tradición la registra
como "CUANTÍA INDETERMINADA / ABIERTA".

ALCANCE: hasta 30 páginas multimodales en un turno. La cifra puede estar en
carátula, cláusula de mutuo, cláusula de pago de la compraventa, casilla de
liquidación, o cualquier parte del cuerpo — recorre TODO.

PROCEDIMIENTO OBLIGATORIO (en este orden):

PASO 1 — ENUMERAR
Lista TODAS las cifras monetarias en pesos colombianos ($) que veas en el
documento, sin filtrar. Para cada una captura el fragmento textual literal
(máx. ~140 caracteres alrededor de la cifra) tal como aparece.

PASO 2 — CLASIFICAR
Para cada cifra, decide su rol SEGÚN EL CONTEXTO SEMÁNTICO que la rodea
(no por proximidad a palabras clave). Clasifica en UNA de estas categorías:

  - "cuantia_credito"    → la suma que el banco presta / concede / desembolsa
                           / entrega al deudor, O que la escritura llama
                           explícitamente cuantía del mutuo, valor del crédito,
                           monto del préstamo, cuantía del crédito otorgado,
                           o equivalente semántico (aunque el verbo no esté
                           conjugado: construcciones nominales tipo "la cuantía
                           del crédito otorgado es: $X" cuentan).
  - "precio_venta"       → precio de la compraventa del inmueble.
  - "avaluo"             → avalúo catastral o comercial.
  - "subrogacion"        → liberación / subrogación de gravamen previo.
  - "abono_saldo"        → abono, saldo pendiente, cuota inicial.
  - "subsidio"           → subsidio familiar, cesantías aplicadas.
  - "uvr_upac"           → cifra expresada en UVR o UPAC (nunca en pesos como
                           cuantía principal — la real está en pesos M/CTE).
  - "otro"               → honorarios, gastos notariales, impuestos, seguros,
                           tasas, cualquier otro concepto.

PASO 3 — DESAMBIGUAR (elige UNA salida)

  a) Exactamente UNA cifra clasificada como "cuantia_credito"
     → úsala. Confianza = "alta".

  b) VARIAS cifras "cuantia_credito" con el MISMO monto normalizado
     (mismo entero en pesos, ignorando formato/decimales/UVR paralelo)
     → úsala. Confianza = "alta" (redundancia entre mutuo, pago y liquidación
     es lo esperado en escrituras bien redactadas).

  c) VARIAS cifras "cuantia_credito" con montos DISTINTOS que no puedes
     conciliar → devuelve monto = null, motivo_null = "ambigua_multiple".
     Confianza = "baja".

  d) CERO cifras "cuantia_credito" pero la escritura declara expresamente
     "HIPOTECA ABIERTA", "SIN LÍMITE DE CUANTÍA" o "DE CUANTÍA INDETERMINADA"
     → monto = null, es_indeterminada = true, motivo_null = "escritura_declara_abierta".
     Confianza = "alta".

  e) CERO cifras "cuantia_credito" y sin declaración de apertura
     → monto = null, motivo_null = "sin_evidencia". Confianza = "baja".

REGLAS DE FORMATO (solo aplican al caso a/b):
- valor_hipoteca_original = "<LETRAS EN MAYÚSCULAS> DE PESOS ($<NÚMEROS CON PUNTOS DE MILES>)"
- valor_hipoteca_es_indeterminada = false

ANTI-ALUCINACIÓN (estricto):
- NUNCA promuevas a "cuantia_credito" una cifra cuyo contexto la ubica en las
  categorías precio_venta / avaluo / subrogacion / abono_saldo / subsidio /
  uvr_upac / otro. Estas cifras se enumeran y clasifican, pero se descartan.
- NUNCA inventes una cifra que no aparece literalmente en el documento.
- NUNCA devuelvas "N/A", "ilegible", "?", "---" ni literales descriptivos en
  el campo de monto. Si dudas, monto = null con motivo_null correcto.
- Si el texto es ilegible en una cifra, no la incluyas en candidatos_vistos.

DEVUELVE SIEMPRE candidatos_vistos con TODAS las cifras enumeradas en PASO 1
(no solo la ganadora). Esto es auditoría — no lo omitas ni siquiera en caso a).

Llama SIEMPRE a extract_cuantia_credito_dedicada.
```

### Few-shots (3 ejemplos con montos distintos, embebidos como bloque `EJEMPLOS:` al final del system prompt)

**Ejemplo 1 — MUTUO clásico (caso ya cubierto, monto distinto al hardcodeado actual para eliminar sesgo)**

> Fragmento: "…el BANCO POPULAR S.A. concede al deudor un mutuo por la suma de VEINTICINCO MILLONES DE PESOS ($25.000.000) M/CTE, garantizado con hipoteca…"
> Salida: `valor_hipoteca_original = "VEINTICINCO MILLONES DE PESOS ($25.000.000)"`, `es_indeterminada = false`, `motivo_null = null`, `candidatos_vistos = [{fragmento, clasificacion:"cuantia_credito", monto:25000000}]`, `confianza = "alta"`.

**Ejemplo 2 — Construcción nominal de carátula (el patrón que hoy falla)**

> Fragmento: "PARA EFECTOS DE LIQUIDACIÓN, LA CUANTÍA DEL CRÉDITO OTORGADO ES: $ 8.558.475.oo" + más adelante "precio de venta: $65.000.000" + "avalúo catastral: $12.400.000".
> Salida: `valor_hipoteca_original = "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS ($8.558.475)"`, `es_indeterminada = false`, `motivo_null = null`, `candidatos_vistos = [{..., "cuantia_credito", 8558475}, {..., "precio_venta", 65000000}, {..., "avaluo", 12400000}]`, `confianza = "alta"`.

**Ejemplo 3 — Ambigüedad real (dos cifras irreconciliables → null)**

> Fragmentos: "cláusula sexta: el mutuo asciende a CINCUENTA MILLONES DE PESOS ($50.000.000)" + "cláusula décima: reliquidado el crédito, el saldo insoluto es SESENTA Y DOS MILLONES DE PESOS ($62.000.000) al momento del otorgamiento".
> Salida: `valor_hipoteca_original = null`, `es_indeterminada = false`, `motivo_null = "ambigua_multiple"`, `candidatos_vistos = [{..., "cuantia_credito", 50000000}, {..., "cuantia_credito", 62000000}]`, `confianza = "baja"`.

## 2) Nuevo schema del tool (parameters JSON Schema, línea 1395-1414)

Migra a schema estricto con enum. Se mantiene compatibilidad hacia atrás (los dos campos actuales siguen siendo `required`).

```json
{
  "type": "object",
  "properties": {
    "valor_hipoteca_original": { "type": ["string","null"], "description": "…mismo formato…" },
    "valor_hipoteca_es_indeterminada": { "type": "boolean", "description": "…" },
    "confianza": { "type": "string", "enum": ["alta","media","baja"] },
    "motivo_null": {
      "type": ["string","null"],
      "enum": ["sin_evidencia","ambigua_multiple","escritura_declara_abierta",null],
      "description": "OBLIGATORIO no-null cuando valor_hipoteca_original es null. null cuando extracción fue exitosa."
    },
    "candidatos_vistos": {
      "type": "array",
      "description": "TODAS las cifras enumeradas en PASO 1 con su clasificación. NO omitir aunque haya ganador claro.",
      "items": {
        "type": "object",
        "properties": {
          "texto_fragmento": { "type": "string", "maxLength": 200 },
          "clasificacion": {
            "type": "string",
            "enum": ["cuantia_credito","precio_venta","avaluo","subrogacion","abono_saldo","subsidio","uvr_upac","otro"]
          },
          "monto": { "type": ["integer","null"], "description": "Entero en pesos, sin decimales ni separadores. null si la cifra está expresada solo en UVR/UPAC." },
          "pagina_aprox": { "type": ["integer","null"] }
        },
        "required": ["texto_fragmento","clasificacion","monto"],
        "additionalProperties": false
      }
    }
  },
  "required": ["valor_hipoteca_original","valor_hipoteca_es_indeterminada","motivo_null","candidatos_vistos"],
  "additionalProperties": false
}
```

Y la interfaz TS espejo (línea 1452):

```ts
type CuantiaMotivoNull = "sin_evidencia" | "ambigua_multiple" | "escritura_declara_abierta" | null;
type CuantiaClasificacion = "cuantia_credito" | "precio_venta" | "avaluo" | "subrogacion" | "abono_saldo" | "subsidio" | "uvr_upac" | "otro";
interface CuantiaCandidato { texto_fragmento: string; clasificacion: CuantiaClasificacion; monto: number | null; pagina_aprox?: number | null; }
interface CuantiaDedicadaResult {
  valor_hipoteca_original?: string | null;
  valor_hipoteca_es_indeterminada?: boolean;
  confianza?: "alta" | "media" | "baja";
  motivo_null?: CuantiaMotivoNull;
  candidatos_vistos?: CuantiaCandidato[];
}
```

## 3) Telemetría enriquecida (línea 2222-2244)

En la llamada a `logCuantiaEvent`, `extra` pasa a incluir:

```ts
extra: {
  trigger: "auto",              // o "manual" desde reprocess_cuantia
  paginas_totales, truncado, error_status, error_msg,
  motivo_null: cuantiaRun?.result?.motivo_null ?? null,
  confianza: cuantiaRun?.result?.confianza ?? null,
  candidatos_vistos: cuantiaRun?.result?.candidatos_vistos ?? [],   // ← nuevo
  candidatos_cuantia_credito_count:
    (cuantiaRun?.result?.candidatos_vistos ?? []).filter(c => c.clasificacion === "cuantia_credito").length,
}
```

Y el `resultado` textual del evento se afina — dejamos de mezclar semántica:

```
- si motivo_null === "escritura_declara_abierta"        → "indeterminada_confirmada"
- si motivo_null === "ambigua_multiple"                 → "fallo_ambiguo_multiple"
- si motivo_null === "sin_evidencia"                    → "fallo_sin_evidencia"
- errores http/red conservan sus etiquetas actuales
- éxito conserva "exito"
```

`fallo_ambiguo` desaparece como balde único. Los históricos ya escritos se quedan como están (no reescribimos telemetría).

## 4) Validación regresiva de los 3 casos históricos

Antes de desplegar, correr el prompt nuevo contra los tres trámites reales cuyos PDFs siguen en storage (`escritura_antecedente_adjunta`):

| Caso | Fecha | Estado hoy | Resultado esperado con prompt nuevo |
|---|---|---|---|
| `4b05d210` (2026-06-24) | éxito | monto $8.558.475 | debe seguir devolviendo el mismo monto — regresión-cero |
| `290fd66a` (2026-07-06) | fallo_ambiguo | monto encontrado | debe reclasificar: o bien devolver monto real, o bien `motivo_null` específico |
| `2bef1db3` (2026-07-07, Sertuss) | fallo_ambiguo | monto encontrado | ídem — es el caso que motiva el rediseño |

Mecánica: script Deno one-shot que reusa `extractCuantiaDedicada` con el prompt nuevo, resolviendo URLs firmadas de storage a partir de cada `cancelaciones.escritura_antecedente_adjunta`. Corre local en el sandbox del edge deploy contra `LOVABLE_API_KEY`, imprime `candidatos_vistos` completos y decisión final por caso. No escribe en BD. Umbral de aceptación:

- Caso `4b05d210` debe devolver el mismo monto (dígitos exactos).
- Al menos uno de los otros dos debe pasar a "éxito" o a un `motivo_null` accionable (no genérico).
- Ninguno debe alucinar cifras ausentes del PDF (se verifica a mano contra `candidatos_vistos`).

Si el umbral no se cumple, iteramos sobre el prompt antes de tocar producción.

## 5) Alcance NO tocado (defensa en profundidad intacta)

- Lista negra semántica: conservada íntegra, ahora como enum de clasificación en vez de lista textual (más difícil de saltar).
- Contrato de dos campos `valor_hipoteca_original` + `_es_indeterminada`: intacto. El skill `extraccion-cuantia-semantica` se cumple.
- `mergeCuantiaIntoExtracted`: sin cambios — sigue leyendo `valor_hipoteca_original`.
- Precedencia manual > IA > BD: intacta.
- BD (`cancelaciones`): sin migración; los nuevos campos viven solo en el JSON del tool-call y en `system_events.detalle` (JSONB).
- Trigger condicional (`certIndet && escUrls.length > 0`): sin cambios.

## Pasos de implementación (cuando aprobado)

1. Reemplazar `CUANTIA_DEDICADA_SYSTEM` (1419-1450) + `cuantiaDedicadaTool` parameters (1395-1414) + interfaces (1452-1456).
2. Enriquecer `logCuantiaEvent` y el bloque de resultado (2222-2244) — mismo cambio en el bloque paralelo alrededor de línea 1915.
3. Escribir script one-shot `supabase/functions/procesar-cancelacion/_regression_cuantia.ts` (no invocable como edge function; solo `deno run` manual desde el equipo). Correrlo contra los 3 IDs; adjuntar output.
4. Solo si los 3 casos pasan el umbral, desplegar. Si no, iterar prompt.
5. Sin cambios en Vitest — los tests de `procesar-cancelacion/index_test.ts` cubren cirugías v2 (dirección, SNR, limitaciones), no la cuantía; el rediseño no rompe sus asserts.

## Riesgos y mitigaciones

- **Riesgo 1**: `candidatos_vistos` obligatorio puede aumentar tokens de salida (~200-800 tokens extra). Mitigación: acotar `texto_fragmento` a 200 chars por schema y aceptar el costo — la auditoría vale más que el ahorro.
- **Riesgo 2**: Gemini 2.5 Flash puede omitir `candidatos_vistos` cuando el ganador es obvio. Mitigación: la palabra "OBLIGATORIO no omitir" en el prompt + `required` en JSON Schema; si aun así llega vacío, el tool-call falla validación y cae en `fallo_parse` (ya existente).
- **Riesgo 3**: reclasificar `fallo_ambiguo` → tres etiquetas rompe dashboards que hagan `WHERE resultado='fallo_ambiguo'`. Verificar antes: `rg "fallo_ambiguo" src/ supabase/` — si aparece en admin/analytics, actualizar esos filtros a `resultado LIKE 'fallo_%'` en la misma sesión de deploy.
