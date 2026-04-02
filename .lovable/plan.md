

## Plan: Corrección de raíz — 3 problemas identificados

### Diagnóstico profesional

Analicé los documentos que cargaste, los datos en la base de datos, y el flujo completo. Los datos SÍ se extraen correctamente por la IA. El problema es de **conexión entre datos y plantilla**.

**Datos extraídos confirmados en la DB:**
- `matricula_inmobiliaria`: "50C-2025538" ✓
- `direccion`: "KR 4 1 46 SUR ET 3 TO 7 AP 905" ✓
- `linderos`: completos ✓
- `nupre`: "AAA0264SBWW" ✓
- `area_construida`: "45.20 M2" ✓
- `avaluo_catastral`: "113598000" ✓
- `notaria_origen`: "VEINTIUNO de BOGOTA D. C." ✓
- `numero_escritura`: "300" ✓
- Y muchos más...

### Problema 1: Banner de "Configure su notaría" incorrecto

El banner aparece porque las tablas `notaria_styles` y `configuracion_notaria` están vacías. Pero los datos de la notaría de origen YA están en `extractedDocumento.notaria_origen` ("VEINTIUNO de BOGOTA D. C."). El sistema no debería pedir configuración manual si puede extraer esos datos del certificado.

**Solución**: El banner solo debe mostrarse si NO hay notariaConfig Y TAMPOCO hay datos en extractedDocumento. Además, cuando no existe config de notaría pero sí hay datos del certificado, usar esos datos como fallback para los placeholders de notaría del documento de origen (antecedentes).

### Problema 2: `extracted_predial` nunca se guarda separado

En `DocumentUploadStep.tsx` línea 291-298, los datos del predial se mezclan DENTRO de `extractedInmueble` en vez de guardarse también como `extracted_predial`. En `Validacion.tsx` se busca `metadata.extracted_predial` que nunca existe.

**Solución**: Guardar los datos prediales TAMBIÉN como `extracted_predial` en metadata para que `Validacion.tsx` los encuentre y los pase al preview.

### Problema 3: Campos que aparecen como vacíos en el preview pero tienen datos

Los datos ESTÁN en el inmueble pero el preview no los muestra porque:
- `extractedPredial` es null (problema 2)
- El banner de notaría bloquea visualmente la percepción
- Algunos campos como `reformas_ph` y `escritura_constitucion_ph` se guardaron con texto descriptivo largo en vez del formato esperado por `parseEscrituraString()`

### Cambios

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | Cambiar condición del banner: solo mostrar si no hay notariaConfig NI extractedDocumento. Usar extractedDocumento como fallback para `notario_nombre`, `notaria_nombre`, etc. |
| `src/components/tramites/DocumentUploadStep.tsx` | Agregar `extracted_predial` como copia separada en metadata cuando el slot es tipo "predial" |
| `src/pages/Validacion.tsx` | Fallback: si `metadata.extracted_predial` no existe, intentar leer campos prediales desde `extracted_inmueble` |

3 archivos, cambios quirúrgicos.

