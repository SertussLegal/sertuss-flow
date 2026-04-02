
## Análisis exhaustivo: Previsualización no refleja datos de documentos

### Flujo de datos actual

```text
Documentos → scan-document (OCR/IA) → DocumentUploadStep → metadata.extracted_inmueble/extracted_personas → Validacion.tsx (loadTramite) → estado local (vendedores, inmueble, etc.) → DocxPreview.buildReplacements → HTML con reemplazos
```

### Problemas identificados

**Problema 1: La plantilla Word tiene placeholders que NO coinciden con `buildReplacements`**

El componente `DocxPreview` carga `template_venta_hipoteca.docx`, lo convierte a HTML con mammoth, y luego intenta reemplazar placeholders como `{comparecientes_vendedor}`, `{matricula_inmobiliaria}`, etc. Pero **no podemos verificar** qué placeholders tiene realmente la plantilla Word sin inspeccionar su contenido después de la conversión mammoth.

Si la plantilla usa nombres distintos (ej: `{vendedor_nombre}` en vez de `{comparecientes_vendedor}`), los reemplazos nunca se aplican y todo queda como `___________`.

**Acción**: Agregar un `console.log` temporal que imprima los placeholders encontrados en el HTML después de `normalizeTemplateTags`, para verificar que los nombres coincidan con los keys de `buildReplacements`.

**Problema 2: La función `normalizeTemplateTags` puede fallar con placeholders anidados en tags complejos**

La regex `\{(?:[^}<]*(?:<[^>]*>[^}<]*)*)\}/g` asume cierta estructura. Si mammoth genera HTML donde `{` y `}` están en distintos párrafos o elementos con nesting profundo, la regex no los captura y los placeholders quedan fragmentados — imposibles de reemplazar.

**Problema 3: Los datos del certificado de tradición SÍ llenan el inmueble, pero hay campos faltantes en el mapa de reemplazos**

El certificado extrae campos como `nupre`, `tipo_predio`, `es_propiedad_horizontal`, `escritura_constitucion_ph`, etc. Estos campos se guardan en `extractedInmueble` y se cargan en el estado `inmueble`, PERO el `buildReplacements` de `DocxPreview` **no tiene mapeo** para ellos. Si la plantilla Word usa esos placeholders, quedan como `{nupre}` → se convierten a `___________` por la línea 219 (catch-all).

**Problema 4: Los datos del vendedor SÍ están pero hay un desfase de timing**

Mirando el screenshot, el vendedor MAYA MONTOYA sí aparece en los campos de la derecha. El `buildReplacements` debería generar `comparecientes_vendedor` con esos datos. Si la previsualización de la izquierda aún muestra blanks, puede ser que:
- El template no usa `{comparecientes_vendedor}` sino otro nombre
- El debounce de 500ms no se ha ejecutado todavía
- El `baseHtml` no tiene ese placeholder porque mammoth lo fragmentó de una forma que `normalizeTemplateTags` no capturó

### Solución propuesta

**Paso 1 — Diagnóstico con logging** (en `DocxPreview.tsx`):
- Después de `normalizeTemplateTags`, hacer `console.log` de TODOS los placeholders `{...}` encontrados en el HTML
- En `buildReplacements`, hacer `console.log` de las keys y values del mapa
- Esto revelará exactamente qué nombres usa la plantilla vs qué nombres espera el código

**Paso 2 — Ampliar `buildReplacements`** para cubrir todos los campos extraídos del inmueble que faltan:
- `nupre`, `tipo_predio`, `area_construida`, `area_privada`, `escritura_ph`, `reformas_ph`

**Paso 3 — Mejorar `normalizeTemplateTags`** con un enfoque más robusto:
- En vez de una sola regex, trabajar sobre el texto plano: extraer todo el texto sin tags, encontrar `{...}` en el texto plano, y mapear esas posiciones de vuelta al HTML para reconstruir los placeholders como strings continuos

**Paso 4 — Agregar logging temporal al edge function** `scan-document` para verificar que los datos extraídos se envían correctamente al frontend (ya existe en las líneas 358-379, pero necesitamos verlos en los logs)

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | Agregar console.log de diagnóstico; ampliar `buildReplacements`; mejorar `normalizeTemplateTags` |

1 archivo principal. Los logs de diagnóstico se removerán una vez confirmado el fix.

### Recomendación

Antes de implementar cambios a ciegas, necesitamos ver los logs de diagnóstico para confirmar cuál de los 4 problemas es el real. La implementación más segura es:
1. Agregar logging → probar → ver qué placeholders tiene realmente la plantilla
2. Ajustar `buildReplacements` o la plantilla según los resultados
3. Remover logging

¿Apruebas este plan de diagnóstico + corrección?
