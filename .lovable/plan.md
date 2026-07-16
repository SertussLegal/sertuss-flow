# Plan — Zona ORIP en Cancelaciones (revertir + diseño real)

## Parte 1 — Reversión

Confirmado: el módulo `scan-document/core/certificadoTradicion/*` es el OCR de **Compraventa** (extractor tipo `certificado_tradicion` para el flujo de tramites de compraventa/hipoteca, no de Cancelaciones). El flujo real de Cancelaciones tiene su propio schema Gemini embebido dentro de `supabase/functions/procesar-cancelacion/index.ts` (líneas 214-266), y ahí NO existe ningún campo `codigo_orip` — la ORIP se infiere implícitamente de `inmueble.ciudad`. Por lo tanto los cambios del turno anterior no llegan al pipeline de Alejandra.

Reversión a estado previo (`edt-842bf2bd-…`) de:
- `supabase/functions/scan-document/core/certificadoTradicion/tool.ts` — restaurar `codigo_orip: confField("Código o nombre de la Oficina de Registro (ORIP)")`.
- `supabase/functions/scan-document/core/certificadoTradicion/prompt.ts` — remover la sección "REGLA ORIP" añadida.
- `supabase/functions/scan-document/core/certificadoTradicion/prompt_test.ts` — remover los 2 tests `ORIP-ZONA` (dejar los `A11` que ya existían).

## Parte 2 — Hallazgos del pipeline real de Cancelaciones

Evidencia leída en `procesar-cancelacion/index.ts`:

- **Schema Gemini `inmueble`** (L214-266): props = `matricula_inmobiliaria`, `descripcion_predio`, `nomenclatura_predio`, **`ciudad`**, `departamento`, `menciones_direccion[]`, `menciones_matricula[]`, `direccion_candidatas[]`. No hay `orip`, `oficina_registro`, ni `zona_orip`. `required: ["matricula_inmobiliaria","descripcion_predio","nomenclatura_predio","ciudad"]`.
- **`ciudad_inmueble`** se calcula una sola vez (L957: `fixOcrTypos(data.inmueble.ciudad)`) y se usa en 3 sitios:
  1. Coletilla dirección: `buildNomenclaturaFinal({ ciudad: ciudadInmueble, ... })` → arma `" DE LA CIUDAD Y/O MUNICIPIO DE ${ciudad}..."` (L749).
  2. Detector `esBogota` regex `/^BOGOTA(\s|,|\.|$|D)/i` (activa sufijo "(DIRECCION CATASTRAL)").
  3. Se emite como tag Docxtemplater `ciudad_inmueble` (L1157), que es lo que la plantilla v2 imprime en la cláusula "Oficina de Registro de Instrumentos Públicos de {{ciudad_inmueble}}".
- **Confirmación empírica**: el .docx real del trámite `1c63c1aa-…` imprime "…Instrumentos Públicos de BOGOTA D.C." (sin zona). Coincide 1:1 con `data.inmueble.ciudad = "BOGOTA D.C."` (el OCR nunca capturó la zona porque el schema no la pide).
- **Colisión de tag**: el mismo `{{ciudad_inmueble}}` se usa tanto en la cláusula ORIP como (potencialmente) en la coletilla de dirección expandida dentro de `nomenclatura_predio`. Si se contamina con "BOGOTA D.C. ZONA CENTRO", la coletilla quedaría "...DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C. ZONA CENTRO..." — incorrecto. Por lo tanto **no se puede reutilizar `ciudad_inmueble`** con el valor concatenado.

## Parte 3 — Diseño propuesto (a implementar tras aprobación)

### 3.1 Schema Gemini (`procesar-cancelacion/index.ts`, bloque `inmueble` L214+)

Añadir campo **opcional** (no en `required`):
```ts
oficina_registro_zona: {
  type: "string",
  description: "Zona de la Oficina de Registro de Instrumentos Públicos (ORIP), SOLO si el encabezado del certificado la menciona explícitamente. Bogotá tiene múltiples zonas ORIP legalmente distintas (CENTRO/NORTE/SUR/OCCIDENTE/ZIPAQUIRA/FACATATIVA/FUSAGASUGA). Si el encabezado dice 'REGISTRO DE INSTRUMENTOS PUBLICOS DE BOGOTA ZONA CENTRO' → devuelve 'ZONA CENTRO' (SOLO la zona, sin repetir ciudad — la ciudad va en 'ciudad'). Si el certificado NO menciona zona → cadena vacía ''. PROHIBIDO inventar la zona."
}
```

Además, una línea en el prompt (`generateExtractionPrompt` alrededor de L370-395) que refuerce la regla y aclare que la zona va SOLO en `oficina_registro_zona`, nunca dentro de `ciudad`.

### 3.2 Backend `buildDocxVars` (procesar-cancelacion/index.ts)

Nueva variable derivada (sin tocar `ciudad_inmueble` — preserva los otros 2 usos):
```ts
const zonaOrip = fixOcrTypos((data.inmueble.oficina_registro_zona || "").trim());
const oficinaRegistroCiudad = zonaOrip
  ? `${ciudadInmueble} ${zonaOrip}`
  : ciudadInmueble;
```
Y emitirla en `vars`:
```ts
oficina_registro_ciudad: oficinaRegistroCiudad || undefined,
```

### 3.3 Plantilla v2 — SÍ requiere edición (esta es la parte incómoda)

Como el tag actual en la cláusula ORIP es `{{ciudad_inmueble}}` (mismo tag que se usa dentro de la coletilla que arma `nomenclatura_predio`), **la plantilla `formato cancelacion hipoteca blanqueado v2.docx` en el bucket `cancelaciones-plantillas` necesita cambiar SOLO ese `{{ciudad_inmueble}}` específico** (el de la cláusula "Oficina de Registro de Instrumentos Públicos de …") por `{{oficina_registro_ciudad}}`.

Opciones para hacerlo:
- **Opción A (recomendada, humana)**: Alejandra (o quien maneja plantillas) descarga v2, edita en Word ese único tag y sube reemplazando. Cero riesgo de dañar estilos. Requiere coordinación fuera de este chat.
- **Opción B (script)**: escribir un edge/script one-shot que baje v2, use `pizzip` para reemplazar textualmente `{{ciudad_inmueble}}` **por ocurrencia posicional** (no globalmente — el otro uso legítimo dentro de la coletilla debe quedar intacto). Requiere identificar el `<w:t>` exacto por contexto ("Oficina de Registro de Instrumentos Públicos de "). Frágil si el tag está partido entre runs.

### 3.4 Fallback de compatibilidad

Para no romper trámites/plantillas viejas mientras se propaga el cambio de plantilla: emitir **ambos** tags con el mismo valor consolidado en la cláusula ORIP, pero mantener `ciudad_inmueble` puro (sin zona) para la coletilla. Es decir:
- `ciudad_inmueble` = solo ciudad, sin zona (compat retro para coletilla y plantillas antiguas).
- `oficina_registro_ciudad` = ciudad + zona (nuevo tag dedicado, plantilla v2 editada lo consumirá).

Trámites viejos que sigan usando la plantilla antigua imprimirán "BOGOTA D.C." (comportamiento actual). Trámites nuevos con plantilla v2 editada imprimirán "BOGOTA D.C. ZONA CENTRO".

### 3.5 Tests

- `procesar-cancelacion/index_test.ts` (o test nuevo): con `inmueble.ciudad="BOGOTA D.C."` + `oficina_registro_zona="ZONA CENTRO"` → `vars.oficina_registro_ciudad === "BOGOTA D.C. ZONA CENTRO"` y `vars.ciudad_inmueble === "BOGOTA D.C."`.
- Caso sin zona: `vars.oficina_registro_ciudad === vars.ciudad_inmueble === "MEDELLIN"`.
- Verificar que `nomenclaturaFinal` (coletilla) NO contiene "ZONA".

## Respuestas a tus 3 preguntas

1. **¿Cuál es la variable actual en la plantilla v2?** Es `{{ciudad_inmueble}}` — el mismo tag que se usa en la coletilla de dirección. No hay tag independiente hoy.
2. **¿La plantilla necesita edición?** Sí, obligatoriamente, porque el tag actual está compartido y sobrecargarlo con la zona rompería la coletilla. No hay forma limpia de resolverlo solo con código sin ensuciar los otros 2 usos.
3. **¿Otro punto de lectura de `ciudad`/`ciudad_inmueble` que se escape?** Los 3 usos identificados (coletilla, esBogota, tag docx) son los únicos en `procesar-cancelacion/index.ts`. `ciudad_inmueble` también se copia a la fila persistida en `cancelaciones` (L3160) para display en UI — ese uso queda intacto porque no incluimos la zona ahí.

## Confirmaciones pendientes antes de implementar

- ¿Ok con **mantener `ciudad_inmueble` limpio + nuevo tag `oficina_registro_ciudad`** (opción de menor riesgo, retrocompatible)?
- ¿Quién edita la plantilla v2 en el bucket — Alejandra manualmente (A) o script one-shot con pizzip (B)?
- ¿Persistimos `oficina_registro_zona` en la tabla `cancelaciones` (columna nueva) o solo lo mantenemos volátil dentro de `data_final` JSON? Recomendación: solo dentro de `data_final` (evita migración).
