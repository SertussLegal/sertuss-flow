## Diagnóstico de causa raíz — corrijo mi conclusión anterior

**Mi reporte previo estaba mal.** V6 SÍ corrió en el caso `0443d2f1`. La ausencia del bloque `apoderado` anidado no viene de que el flag esté apagado, sino de que el OCR no pudo leer la cláusula de poder en ese PDF específico.

## Evidencia línea por línea

### 1. Lectura del env var (nombre exacto)

`supabase/functions/_shared/poderBancoSchemaVersion.ts:60-61`

```ts
export const POWER_V6_EXTRACTOR_ENABLED =
  (Deno.env.get("POWER_V6_EXTRACTOR_ENABLED") ?? "false") === "true";
```

Nombre leído: `POWER_V6_EXTRACTOR_ENABLED`. Nombre del secret listado por `fetch_secrets`: `POWER_V6_EXTRACTOR_ENABLED`. **Coinciden carácter por carácter.**

### 2. Gate del extractor v6 (condición completa)

`supabase/functions/procesar-cancelacion/index.ts:2340-2348`

```ts
const v6Runner = async (): Promise<PoderBancoDeepPayload | null> => {
  if (!POWER_V6_EXTRACTOR_ENABLED || poderUrls.length === 0) return null;
  try {
    return await extractPoderBancoV6(poderUrls, LOVABLE_API_KEY);
  } catch (e) {
    console.error("[procesar-cancelacion mono] v6 extractor failed:", e);
    return null;
  }
};
```

**Simple OR, no compuesto con V5.** V6 corre siempre que su propio flag esté ON y haya páginas de poder. Idéntico gate en la línea 1973 (segunda entrada del pipeline).

Merge (línea 2372-2374):

```ts
const mergedPoder = POWER_V6_EXTRACTOR_ENABLED
  ? mergePoderBancoV6(extracted.poder_banco, dedicatedResult, v6Result)
  : mergePoderBanco(extracted.poder_banco, dedicatedResult);
```

### 3. Por qué el log dice `v5_enabled: false`

Telemetría en `index.ts:2386-2404`. El bloque `extra` **solo loguea `v5_enabled: POWER_V5_ENABLED`** — no loguea `v6_enabled`. Es una **omisión de telemetría**, no evidencia de que V6 no corrió. Confundí ausencia de log con ausencia de ejecución.

### 4. Prueba positiva de que V6 SÍ corrió en este caso

Los campos `_classifier_motivos`, `has_apoderado_banco_v3` y `motivos_incompletitud` **solo se emiten en la rama V6** del merge (`merge.ts:135-137`). El merge legacy (`mergePoderBanco`) no los produce. El `data_ia.poder_banco` del trámite auditado contiene los tres:

```json
{
  "_classifier_motivos": ["no_apoderado_tipo_from_ocr"],
  "has_apoderado_banco_v3": "null",
  "motivos_incompletitud": ["paginas_parciales_sin_clausula_de_poder"],
  "apoderado_nombre": "null",
  "apoderado_cedula": "null",
  "apoderado_escritura": "DOS MIL CUATROCIENTOS QUINCE (2415)",
  "apoderado_fecha": "DIECINUEVE (19) DE ENERO DE DOS MIL VEINTICINCO (2025)",
  "apoderado_notaria_poder": "TREINTA Y DOS (32) DE BOGOTA D.C."
}
```

**⇒ V6 corrió, devolvió payload, y el merge V6 escribió su output.**

### 5. Por qué no hay bloque `apoderado` anidado

En `merge.ts:112-118`:

```ts
const apoderadoIn = (deepV6.apoderado ?? undefined) as ApoderadoPayload | undefined;
const cls = classifyApoderado(apoderadoIn);
const apoderadoOut = apoderadoIn
  ? { ...apoderadoIn, tipo: cls.tipoEfectivo ?? null }
  : null;
// ...
apoderado: apoderadoOut ?? undefined,   // ← si es null se pierde en JSON
```

Cuando Gemini no encuentra la cláusula (`has_apoderado_banco_v3: "null"` por regla K del prompt en `prompt.ts:29-31`), no puebla `deepV6.apoderado`, entonces `apoderadoOut = null` y la clave `apoderado` sale como `undefined` (se descarta al serializar). Comportamiento **correcto por diseño**: el propio motivo lo dice — `"paginas_parciales_sin_clausula_de_poder"`.

Adicionalmente, `apoderado_nombre` y `apoderado_cedula` quedan como el string literal `"null"` — eso viene del OCR devolviendo la cadena `"null"` en lugar de JSON `null`, y el pipeline no lo normaliza. Es un bug menor de saneamiento, no relacionado con V6.

### 6. Secret y despliegue

- Secret `POWER_V6_EXTRACTOR_ENABLED` **sí figura** en el listado actual (`fetch_secrets`). Su valor no es visible pero el hecho de que V6 haya corrido confirma que está en `"true"`.
- Hora del set del secret y hora del deploy: irrelevante — la prueba positiva (campos exclusivos del merge V6 presentes) demuestra que el runtime que procesó el caso ya tenía el flag ON.

### 7. `Deno.env.get()` en Supabase Edge Functions

No requiere nada especial. El secret configurado en Project Settings → Secrets se expone como env var estándar en el runtime Deno del edge function. La prueba está en que otros secrets del mismo tipo (`LOVABLE_API_KEY`, `GOOGLE_API_KEY`) funcionan sin ceremonia.

## Diagnóstico final

**Causa raíz: NO hay bug de flag.** V6 está activo y corriendo en producción. El caso `0443d2f1` procesó un Poder Davivienda donde el OCR (Gemini 2.5 Flash con el prompt v6) no pudo localizar la cláusula del apoderado — probablemente porque las páginas del PDF están parciales / cortadas / con una firma aislada sin contexto (motivo declarado por el propio modelo: `"paginas_parciales_sin_clausula_de_poder"`).

El pipeline se comportó como está diseñado:
- V6 corrió → devolvió payload sin `apoderado` con `has_apoderado_banco_v3 = "null"`.
- Merge V6 propagó la telemetría (`_classifier_motivos`, `motivos_incompletitud`).
- `apoderado_nombre/cedula` cayeron a la cadena literal `"null"` (bug menor de saneamiento).
- Cuantía semántica funcionó (`indeterminada_confirmada`).
- Trámite terminó `completed`.

## Hallazgos secundarios reales (no bloqueantes)

1. **Telemetría incompleta:** `logPoderEvent.extra` no incluye `v6_enabled` ni un summary del payload V6 (por ejemplo `has_apoderado_banco_v3`, `campos_deep_llenos`). Por eso me confundí. Añadirlo evita futuros diagnósticos falsos.
2. **Saneamiento de `"null"` string:** `mergePoderBancoFlat` no trata `"null"`/`"NULL"` como valor vacío. Si Gemini devuelve la cadena literal `"null"`, se persiste como si fuera un valor real. Debería normalizarse a `undefined`.
3. **Retrocompatibilidad de mi reporte anterior:** el veredicto "V6 no corrió" era **incorrecto**. Corrijo formalmente: **V6 está ON en runtime y funcionó**. El caso simplemente fue un PDF difícil de leer.

## Próximo paso (requiere aprobación para pasar a build)

1. **No hay corrección urgente del flag** — está bien.
2. Antes de invitar a Alejandra, procesar un segundo caso con un Poder Davivienda **completo y legible** para confirmar que en el happy path aparece el bloque `apoderado` anidado con `tipo: "juridica"` y `representantes[]` poblado.
3. (Opcional, mejora chica) Añadir `v6_enabled`, `has_apoderado_banco_v3` y `v6_apoderado_tipo` al bloque `extra` de `logPoderEvent`, y normalizar la cadena `"null"` en el merge.
