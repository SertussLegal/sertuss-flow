

## Plan: Corrección de raíz — Mapeo completo de datos OCR a la previsualización

### Diagnóstico

Analicé exhaustivamente los datos reales en la base de datos, el flujo OCR y el mapeo de placeholders. El problema tiene **3 causas raíz**:

**1. No hay datos guardados en las tablas `inmuebles`, `actos`, `personas`**
La consulta a la DB confirma que las tablas están vacías para este trámite. Los datos solo viven en `tramites.metadata.extracted_inmueble`. Cuando `loadTramite` ejecuta, como no hay registro en `inmuebles`, cae al fallback `extracted_inmueble` y hace un merge parcial. Pero el `Inmueble` interface no tiene campos como `nupre`, `nombre_edificio_conjunto`, `coeficiente`, etc., así que esos datos OCR se pierden.

**2. El `Actos` interface solo tiene 7 campos, pero la plantilla necesita ~25**
La plantilla espera `actos.cuantia_compraventa_letras`, `actos.pago_inicial_numero`, `actos.credito_dia_letras`, etc. Ninguno de estos existe en el modelo de datos. El OCR **no extrae datos de actos** porque no hay documento de "carta de aprobación de crédito" ni similar.

**3. No hay `notaria_styles` ni `configuracion_notaria` configurados**
La consulta confirma que ambas tablas están vacías. Por eso todos los campos `notario_*`, `notaria_*`, `rph.*` salen vacíos. Esto no es un bug — es configuración faltante del usuario.

### Clasificación de los 79 campos vacíos

| Categoría | Campos | Causa | Solución |
|---|---|---|---|
| **Datos OCR no mapeados** (~8) | `area`, `estrato`, `escritura_ph`, `inmueble.nombre_edificio_conjunto`, `inmueble.coeficiente_*` | Datos en `extracted_inmueble` pero no en Inmueble interface | Expandir el mapeo en `loadTramite` usando campos de metadata |
| **Config notaría vacía** (~15) | `notario_nombre`, `notaria_ciudad`, `rph.notaria`, etc. | No hay registros en `notaria_styles` / `configuracion_notaria` | Mostrar banner "Configure su notaría" en el preview |
| **Campos de actos no capturados** (~20) | `actos.cuantia_*_letras`, `actos.pago_inicial_*`, `actos.credito_*` | No existen en el modelo ni se extraen por OCR | Agregar campos al formulario de Actos + conversión número→letras |
| **Campos RPH** (~12) | `rph.escritura_*`, `rph.matricula_matriz` | Datos parciales en `escritura_ph` pero no parseados | Parsear `escritura_ph` para extraer número, fecha, notaría |
| **Campos apoderado banco** (~12) | `apoderado_banco.*` | OCR de poder bancario solo extrae 3 campos básicos | Expandir OCR del poder bancario |
| **Campos derivados** (~12) | `valor_compraventa_letras`, `fecha_escritura_corta`, `escritura_numero` | Requieren conversión de formato (número→letras, fecha→partes) | Agregar funciones de conversión |

### Solución profesional (por prioridad)

**Fase 1 — Mapeo inmediato de datos que YA existen** (este PR)

1. **Expandir `loadTramite`**: Cuando no hay registro en `inmuebles`, mapear TODOS los campos de `extracted_inmueble` incluyendo `nupre`, `es_propiedad_horizontal`, `escritura_constitucion_ph`, `area_construida`, `area_privada`, `tipo_predio`. Usar `area_construida` como fallback para `area` si `area` está vacío.

2. **Parsear `reformas_ph` y `escritura_ph`**: El OCR extrae "ESCRITURA 5035 DEL 07-09-2018 NOTARIA VE..." — extraer número, fecha, notaría y mapear a `rph.escritura`, `rph.escritura_num_numero`, `rph.escritura_mes`, etc.

3. **Agregar conversión número→letras**: Función `numberToWords` para convertir `valor_compraventa` de "150000000" a "CIENTO CINCUENTA MILLONES DE PESOS". Aplicar a `valor_compraventa_letras`, `actos.cuantia_*_letras`, `valor_hipoteca_letras`.

4. **Banner de configuración faltante**: Cuando `notariaConfig` es null, mostrar un banner azul informativo: "Configure los datos de su notaría en Ajustes para completar el documento automáticamente" con link a `/configuracion`.

5. **Eliminar logs de diagnóstico**: Remover los `console.log` de Filled/Empty/Placeholders.

**Fase 2 — Expandir captura de datos** (siguiente PR)

- Agregar más campos al formulario de Actos (pago inicial, saldo financiado, fecha crédito)
- Expandir OCR del poder bancario (expedida_en, escritura_poder, notaría del poder)
- Agregar campo `estrato` al formulario de Inmueble

### Archivos a modificar (Fase 1)

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | Agregar `numberToWords()`, parsear `reformas_ph`/`escritura_ph` para RPH, usar `area_construida` como fallback de `area`, banner de config faltante, remover logs diagnóstico |
| `src/pages/Validacion.tsx` | Expandir mapeo de `extracted_inmueble` para incluir campos adicionales (`nupre`, `es_propiedad_horizontal`, etc.) |

2 archivos. Sin cambios de DB.

