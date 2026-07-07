
# Rediseño de CUANTIA_DEDICADA_SYSTEM — enfoque semántico type-safe

Aplica a `supabase/functions/procesar-cancelacion/index.ts` (líneas 1389-1465 del prompt/tool, 2216-2244 y 1915-1935 de la telemetría) y al modo `reprocess_cuantia` existente. Sin cambios de esquema de BD — solo `system_events.detalle` se enriquece (JSONB, ya soporta claves nuevas).

Nota: este diseño ya se aplicó al código en la sesión anterior de build mode; se re-presenta aquí sin cambios para tu revisión.

## Diagnóstico que ancla el diseño

- El anclaje sintáctico actual exige verbos rectores conjugados (`constituye/grava/…/entrega`). La construcción nominal `"la cuantía del crédito otorgado es: $X"` — fórmula estándar de carátula en escrituras 90s–2000s — falla por diseño.
- El único "éxito" en telemetría (`4b05d210…`) coincide byte-a-byte con el ejemplo hardcodeado del prompt (`$8.558.475`), lo que sugiere sesgo por few-shot único.
- `fallo_ambiguo` colapsa tres estados semánticos distintos (sin evidencia, ambigüedad real, escritura declara abierta) en una etiqueta, sin registrar el texto candidato que vio Gemini.

## 1) Nuevo prompt — enumerar → clasificar → desambiguar

Reemplaza `CUANTIA_DEDICADA_SYSTEM`. El modelo pasa de "buscar patrón fijo" a razonar en tres pasos:

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
     → úsala. Confianza = "alta" (redundancia entre mutuo, pago y liquidación
     es lo esperado en escrituras bien redactadas).

  c) VARIAS cifras "cuantia_credito" con montos DISTINTOS que no puedes
     conciliar → monto = null, motivo_null = "ambigua_multiple". Confianza = "baja".

  d) CERO cifras "cuantia_credito" pero la escritura declara expresamente
     "HIPOTECA ABIERTA" / "SIN LÍMITE DE CUANTÍA" / "DE CUANTÍA INDETERMINADA"
     → monto = null, es_indeterminada = true, motivo_null = "escritura_declara_abierta".
     Confianza = "alta".

  e) CERO cifras "cuantia_credito" y sin declaración de apertura
     → monto = null, motivo_null = "sin_evidencia". Confianza = "baja".

REGLAS DE FORMATO (solo casos a/b):
- valor_hipoteca_original = "<LETRAS EN MAYÚSCULAS> DE PESOS ($<NÚMEROS CON PUNTOS DE MILES>)"
- valor_hipoteca_es_indeterminada = false
- motivo_null = null

ANTI-ALUCINACIÓN (estricto):
- NUNCA promuevas a "cuantia_credito" una cifra cuyo contexto la ubica en las
  categorías precio_venta / avaluo / subrogacion / abono_saldo / subsidio /
  uvr_upac / otro.
- NUNCA inventes una cifra que no aparece literalmente en el documento.
- NUNCA devuelvas "N/A", "ilegible", "?", "---" ni literales descriptivos en
  el campo de monto.
- Si el texto es ilegible en una cifra, no la incluyas en candidatos_vistos.

DEVUELVE SIEMPRE candidatos_vistos con TODAS las cifras del PASO 1 (auditoría).

EJEMPLOS:

Ejemplo 1 — MUTUO clásico (verbo conjugado):
  "…el BANCO POPULAR S.A. concede al deudor un mutuo por la suma de
   VEINTICINCO MILLONES DE PESOS ($25.000.000) M/CTE, garantizado con hipoteca…"
  → valor = "VEINTICINCO MILLONES DE PESOS ($25.000.000)", motivo_null = null.

Ejemplo 2 — Construcción nominal de carátula (escrituras 90s–2000s):
  "PARA EFECTOS DE LIQUIDACIÓN, LA CUANTÍA DEL CRÉDITO OTORGADO ES:
   $ 8.558.475.oo" + "precio de venta: $65.000.000" + "avalúo: $12.400.000".
  → valor = "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA
     Y CINCO PESOS ($8.558.475)", motivo_null = null.
     candidatos_vistos incluye la cifra de crédito, la de venta y la de avalúo.

Ejemplo 3 — Ambigüedad real (dos cifras de crédito irreconciliables → null):
  "cláusula sexta: el mutuo asciende a $50.000.000" + "cláusula décima:
   reliquidado el crédito, el saldo insoluto es $62.000.000".
  → valor = null, motivo_null = "ambigua_multiple", candidatos_vistos con las dos.

Llama SIEMPRE a la herramienta extract_cuantia_credito_dedicada.
```

## 2) Nuevo schema del tool (JSON Schema estricto)

Migra a schema con enums cerrados. Mantiene los dos campos actuales (siguen `required`), añade `motivo_null` y `candidatos_vistos` como `required` nuevos.

```json
{
  "type": "object",
  "properties": {
    "valor_hipoteca_original": {
      "type": ["string", "null"],
      "description": "Monto en formato '<LETRAS EN MAYÚSCULAS> DE PESOS ($<NÚMEROS>)'. JSON null si abierta / ambigua / sin evidencia."
    },
    "valor_hipoteca_es_indeterminada": {
      "type": "boolean",
      "description": "true SOLO si la escritura declara expresamente cuantía abierta."
    },
    "confianza": { "type": "string", "enum": ["alta", "media", "baja"] },
    "motivo_null": {
      "type": ["string", "null"],
      "enum": ["sin_evidencia", "ambigua_multiple", "escritura_declara_abierta", null],
      "description": "Obligatorio no-null cuando valor_hipoteca_original es null."
    },
    "candidatos_vistos": {
      "type": "array",
      "description": "TODAS las cifras enumeradas en PASO 1 con su clasificación.",
      "items": {
        "type": "object",
        "properties": {
          "texto_fragmento": { "type": "string", "maxLength": 200 },
          "clasificacion": {
            "type": "string",
            "enum": ["cuantia_credito","precio_venta","avaluo","subrogacion","abono_saldo","subsidio","uvr_upac","otro"]
          },
          "monto": { "type": ["integer","null"] },
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

Interfaces TS espejo:

```ts
type CuantiaMotivoNull = "sin_evidencia" | "ambigua_multiple" | "escritura_declara_abierta" | null;
type CuantiaClasificacion = "cuantia_credito" | "precio_venta" | "avaluo" | "subrogacion" | "abono_saldo" | "subsidio" | "uvr_upac" | "otro";
interface CuantiaCandidato {
  texto_fragmento: string;
  clasificacion: CuantiaClasificacion;
  monto: number | null;
  pagina_aprox?: number | null;
}
interface CuantiaDedicadaResult {
  valor_hipoteca_original?: string | null;
  valor_hipoteca_es_indeterminada?: boolean;
  confianza?: "alta" | "media" | "baja";
  motivo_null?: CuantiaMotivoNull;
  candidatos_vistos?: CuantiaCandidato[];
}
```

Nota sobre "Zod": el proyecto usa JSON Schema en el tool-call, no Zod. Si prefieres runtime-validation extra con Zod antes del merge, se envuelve con `z.object({...})` en el mismo archivo — decisión aparte.

## 3) Telemetría enriquecida

Helper `deriveCuantiaResultado(run)` reemplaza el balde único `fallo_ambiguo`:

```
- monto extraído ok                             → "exito"
- motivo_null === "escritura_declara_abierta"   → "indeterminada_confirmada"
- motivo_null === "ambigua_multiple"            → "fallo_ambiguo_multiple"
- motivo_null === "sin_evidencia"               → "fallo_sin_evidencia"
- error_status === 413 / "network" / "parse"    → fallo_413 / fallo_red / fallo_parse (sin cambio)
- error_status numérico                         → `fallo_${n}` (sin cambio)
- motivo_null ausente pese al schema            → "fallo_ambiguo_desconocido"
```

Helper `buildCuantiaExtra(run, trigger)` enriquece el `extra` de ambos call-sites:

```ts
{
  trigger, paginas_totales, truncado, error_status, error_msg,
  motivo_null,
  confianza,
  candidatos_vistos,                         // ← nuevo
  candidatos_cuantia_credito_count,          // ← nuevo (derivado)
}
```

El tipo del campo `resultado` en `logCuantiaEvent` se ensancha (`string` o unión explícita). Los históricos no se reescriben.

## 4) Alcance NO tocado (defensa en profundidad intacta)

- Lista negra semántica: conservada íntegra, ahora como enum de clasificación (más difícil de saltar).
- Contrato dos campos `valor_hipoteca_original` + `_es_indeterminada`: intacto. Skill `extraccion-cuantia-semantica` se cumple.
- `mergeCuantiaIntoExtracted`: sin cambios.
- Precedencia manual > IA > BD: intacta.
- Trigger condicional (`certIndet && escUrls.length > 0`): sin cambios.
- BD (`cancelaciones`): sin migración; nuevos campos solo en el JSON del tool-call y en `system_events.detalle` (JSONB).

## 5) Plan de re-validación regresiva (previo al deploy)

Correr el prompt nuevo contra los tres trámites cuyas páginas siguen en storage bajo `<cancelacionId>/cancelaciones/soportes/escritura/*.jpg`.

| Caso | Fecha | Estado hoy | Resultado esperado |
|---|---|---|---|
| `4b05d210` | 2026-06-24 | éxito | debe devolver el mismo monto — regresión-cero |
| `290fd66a` | 2026-07-06 | fallo_ambiguo | reclasificar: monto real o `motivo_null` accionable |
| `2bef1db3` | 2026-07-07 (Sertuss) | fallo_ambiguo | ídem — caso que motiva el rediseño |

Mecánica: script Deno standalone `supabase/functions/procesar-cancelacion/_regression_cuantia.ts` (no invocable como edge function; solo `deno run` manual con `LOVABLE_API_KEY` y credenciales de service_role). Para cada ID:

1. `supabaseService.storage.list(<prefix>)` → mismos paths que usa `reprocess_cuantia`.
2. `createSignedUrl` por página.
3. Llamada a `extractCuantiaDedicada` reusada.
4. Imprime a stdout: `motivo_null`, `confianza`, monto final, `candidatos_vistos` completos.
5. NO escribe en BD, NO consume créditos, NO llama a `logCuantiaEvent`.

Umbral de aceptación:
- `4b05d210` devuelve $8.558.475 exactos.
- Al menos uno de los otros dos pasa a "exito" o a `motivo_null` accionable (no `fallo_ambiguo_desconocido`).
- Ninguno alucina cifras ausentes del PDF (verificación manual contra `candidatos_vistos`).

## Pasos de implementación (cuando aprobado)

1. Reemplazar `CUANTIA_DEDICADA_SYSTEM` + parameters de `cuantiaDedicadaTool` + interfaces.
2. Añadir helpers `deriveCuantiaResultado` y `buildCuantiaExtra`; usarlos en los dos call-sites.
3. Exportar `extractCuantiaDedicada` para que el script standalone la reuse.
4. Escribir `_regression_cuantia.ts`. Correrlo contra los 3 IDs; adjuntar output al ticket.
5. Solo si los 3 casos pasan el umbral, desplegar.
6. Sin cambios en Vitest — los tests actuales cubren cirugías v2 (dirección, SNR, limitaciones), no la cuantía.

## Riesgos y mitigaciones

- **R1** — `candidatos_vistos` obligatorio aumenta tokens de salida (~200–800 extra). Mitigación: `maxLength: 200` en `texto_fragmento`.
- **R2** — Gemini 2.5 Flash podría omitir `candidatos_vistos` cuando el ganador es obvio. Mitigación: `required` en schema + instrucción explícita; si aun así llega vacío, tool-call falla y cae en `fallo_parse` existente.
- **R3** — Reclasificación `fallo_ambiguo` → 3 etiquetas rompería dashboards. Verificado: `rg` no encuentra consumidores externos del literal.
