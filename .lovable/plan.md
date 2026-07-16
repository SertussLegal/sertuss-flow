# Capturar zona ORIP en el certificado de tradición

## Diagnóstico confirmado

- Schema Gemini (`certificadoTradicion/tool.ts:31`) tiene un solo campo `codigo_orip` con description mínima ("Código o nombre de la Oficina de Registro (ORIP)"). **No se instruye a Gemini a capturar la zona** ("BOGOTA ZONA CENTRO").
- El texto "Oficina de Registro de Instrumentos Públicos de …" NO se arma en código: vive como placeholder Docxtemplater dentro de la plantilla `.docx` v2. El tag es `{{orip_ciudad}}` (y hay un `{{orip_zona}}` que hoy siempre llega vacío).
- `src/lib/docxConsolidation.ts:421,441-442`: `orip_ciudad ← inmueble.codigo_orip`, `orip_zona ← ""` hardcoded.
- Resultado actual: si el OCR devuelve "BOGOTA D.C.", la minuta imprime "BOGOTA D.C." y la operadora agrega la zona a mano.

## Enfoque propuesto (mínimo cambio, máximo efecto)

**Opción A — Ampliar la description del OCR únicamente.** Sin schema nuevo, sin migración, sin tocar plantilla.

### Cambio único

`supabase/functions/scan-document/core/certificadoTradicion/tool.ts:31`

Reemplazar:
```ts
codigo_orip: confField("Código o nombre de la Oficina de Registro (ORIP)"),
```
por una description explícita que instruya a Gemini a preservar la zona cuando aparezca en el encabezado del certificado. Regla:

- Si el encabezado dice `REGISTRO DE INSTRUMENTOS PUBLICOS DE <CIUDAD> ZONA <ZONA>` → devolver `"<CIUDAD> ZONA <ZONA>"` (ej: `"BOGOTA ZONA CENTRO"`, `"BOGOTA ZONA NORTE"`, `"BOGOTA ZONA SUR"`).
- Si no aparece zona (ciudades con una sola ORIP) → devolver solo la ciudad tal como aparece.
- Preservar mayúsculas del certificado. No inventar zona si no está escrita.

Opcionalmente, reforzar la misma regla en `supabase/functions/scan-document/core/certificadoTradicion/prompt.ts` (una línea en la sección INMUEBLE).

### Por qué A y no B/C

- **B** (campo `orip_zona` dedicado) requiere: cambio schema OCR + backfill en `docxConsolidation.ts` + editar plantilla v2 en el bucket `cancelaciones-plantillas` para usar `{{orip_ciudad}} {{orip_zona}}`. Más superficie, más riesgo de romper trámites viejos.
- **C** (regex post-proceso) es frágil: depende de que Gemini haya conservado la zona en el string, cosa que hoy justamente no hace.
- Con A, el string "BOGOTA ZONA CENTRO" cae directo en `orip_ciudad` → la plantilla v2 imprime "…de BOGOTA ZONA CENTRO" sin cambiar plantilla ni consolidación.

## Verificación

- Test unitario nuevo en `supabase/functions/scan-document/core/certificadoTradicion/prompt_test.ts` (ya existe el archivo) que asserte contra un fixture con encabezado "ZONA CENTRO" y otro sin zona.
- Regen manual del trámite `1c63c1aa-…` en preview: confirmar que `codigo_orip` extraído ahora contiene "ZONA CENTRO" y que la minuta lo imprime sin edición manual.

## Fuera de alcance

- No se toca la plantilla `.docx` v2.
- No se añaden columnas nuevas a `inmuebles`.
- No se retro-corrigen trámites viejos (Alejandra sigue editando a mano los que ya cerró).
