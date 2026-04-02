

## Plan: Coherencia total del documento — integrar datos de notaría en la previsualización

### Problema

El preview del documento tiene placeholders de notaría (`{notario_nombre}`, `{notario_decreto}`, `{rph.notaria}`, `{antecedentes.notaria}`, etc.) que siempre muestran `___________` porque **nunca se consulta `notaria_styles` ni `configuracion_notaria`** en `Validacion.tsx`. Esto significa que el documento final descargado tampoco tendrá estos datos, a pesar de estar configurados en el sistema.

Además, datos como la notaría mencionada en documentos cargados (certificado de tradición) no se comparan contra la configuración del sistema.

### Solución

**1. Cargar `notaria_styles` y `configuracion_notaria` en `Validacion.tsx`**

En `loadTramite`, agregar consultas para obtener los estilos de notaría de la organización:
```
notaria_styles → nombre_notaria, ciudad, notario_titular, estilo_linderos
configuracion_notaria → numero_notaria, circulo, departamento, tipo_notario, nombre_notario, decreto_nombramiento
```

Guardar en un nuevo estado `notariaConfig` que se pase a `DocxPreview`.

**2. Pasar `notariaConfig` a `DocxPreview` y llenar los placeholders**

Actualizar la interfaz `DocxPreviewProps` para recibir datos de notaría. En `buildReplacements`, mapear:

| Placeholder | Fuente |
|---|---|
| `notario_nombre` | `configuracion_notaria.nombre_notario` o `notaria_styles.notario_titular` |
| `notario_decreto` | `configuracion_notaria.decreto_nombramiento` |
| `rph.notaria` | `notaria_styles.nombre_notaria` |
| `rph.notaria_numero` | `configuracion_notaria.numero_notaria` |
| `rph.notaria_ciudad` | `notaria_styles.ciudad` |
| `antecedentes.notaria` | Datos del certificado de tradición (metadata) |
| Encabezado notaría | `notaria_styles.nombre_notaria` + `ciudad` |

**3. Llenar campos de antecedentes desde metadata del certificado de tradición**

El OCR de `scan-document` ya extrae `notaria_origen`, `escritura_origen`, etc. del certificado. Estos datos están en `tramites.metadata.extracted_inmueble` pero no se mapean a los placeholders de `antecedentes.*`. Conectar estos datos.

**4. Validación cruzada de coherencia**

Agregar una verificación simple: si `metadata.extracted_inmueble.notaria_origen` no coincide con `notaria_styles.nombre_notaria`, mostrar un banner informativo en el preview indicando la diferencia. No bloqueante.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/Validacion.tsx` | Consultar `notaria_styles` + `configuracion_notaria` en `loadTramite`, crear estado `notariaConfig`, pasarlo a `DocxPreview` |
| `src/components/tramites/DocxPreview.tsx` | Recibir `notariaConfig` en props, llenar placeholders de notaría y antecedentes con datos reales |

2 archivos modificados.

