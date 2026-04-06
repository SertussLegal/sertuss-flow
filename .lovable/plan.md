

## Auditoría UX/DX — Mejoras de Carga Dinámica y Visualización

### Hallazgos principales

Tras revisar los 6 archivos core del pipeline (DocumentUploadStep, Validacion, DocxPreview, PersonaForm, InmuebleForm, ExpedienteSidebar), identifico **7 problemas concretos** que degradan la experiencia:

### Problema 1: Duplicación de carga de documentos
El paso 1 (`DocumentUploadStep`) carga documentos y extrae datos. El paso 2 (`Validacion`) tiene **otro set de botones de carga** dentro de `InmuebleForm` (líneas ~50+). El usuario debe volver a cargar documentos que ya subió. Los datos del paso 1 se persisten en `metadata` pero los botones del paso 2 no los reconocen como "ya procesados".

**Corrección**: En `InmuebleForm`, detectar si `metadata` ya tiene datos extraídos y ocultar los botones de carga redundantes, mostrando en su lugar badges de "Ya procesado" con el nombre del archivo.

### Problema 2: Inconsistencia visual de campos vacíos
Dos estilos compiten: el post-procesador de `DocxPreview` genera `<span class="var-pending">___________</span>` con fondo rojo, pero los `___________` dentro de loops de personas se generan como texto plano antes del post-procesador y a veces no se capturan. El resultado: unos campos vacíos tienen cuadro rojo y otros solo líneas.

**Corrección**: El "FINAL PASS" (líneas 680-707 de DocxPreview) ya intenta unificar, pero falla en 2 casos: (a) `___________` dentro de atributos `style` o `title`, (b) `___________` que están justo antes de `</span>` sin espacio. Refactorizar el regex para capturar todos los casos restantes.

### Problema 3: ExpedienteSidebar sin funcionalidad de carga
El sidebar muestra documentos pero el botón "Subir documento" no está conectado a ningún handler real. `onUploadDocument` no se pasa desde `Validacion.tsx` (línea 1564: `<ExpedienteSidebar documentos={expedienteDocs} />`).

**Corrección**: Pasar `onUploadDocument` al sidebar e implementar el handler que invoque `scan-document`, actualice metadata, y re-hidrate los campos correspondientes.

### Problema 4: Mobile sin previsualización ni sidebar
En mobile (líneas 1600-1604), solo se renderizan los tabs de formulario sin preview ni sidebar. El usuario no puede ver cómo queda el documento.

**Corrección**: Agregar un botón flotante o un toggle para mostrar el preview en un sheet/drawer en mobile.

### Problema 5: Formularios sin indicadores de origen de datos
Cuando un campo se llena por OCR, no hay indicación visual de que el dato vino de IA vs. manual. Solo `OcrBadge` existe en `PersonaForm` pero está atado al escaneo local, no al OCR del paso 1.

**Corrección**: En `loadTramite`, construir un set de campos llenados por OCR (`ocrFilledFields`) y pasarlo a los formularios para que muestren un badge sutil (ej: "IA" en azul claro) al lado del campo.

### Problema 6: Campos del paso 1 no llegan a los forms del paso 2
`estado_civil` y `direccion` solo se llenan si hay `extracted_escritura_comparecientes` en metadata Y la reconciliación encuentra match por CC. Pero si el usuario no cargó la escritura en el paso 1, estos campos quedan vacíos sin explicación.

**Corrección**: Agregar un banner contextual en `PersonaForm` que diga "Para completar estado civil y dirección, sube la Escritura Antecedente" cuando estos campos estén vacíos y no haya escritura procesada.

### Problema 7: Toggles opcionales no se restauran al recargar
Si el usuario activa "Crédito hipotecario" y luego recarga la página de validación, los toggles no se restauran porque `Validacion.tsx` lee `meta.toggles` (línea 439-443) pero no los expone a ningún UI element.

**Corrección**: Leer `meta.toggles` y reflejar el estado en `actos.es_hipoteca` si `tieneCredito` estaba activo, asegurando coherencia entre el toggle del paso 1 y el checkbox del paso 2.

### Plan de implementación (5 archivos)

| Archivo | Cambio |
|---|---|
| `src/pages/Validacion.tsx` | Conectar `onUploadDocument` al sidebar, preview mobile (sheet), banner de campos pendientes |
| `src/components/tramites/DocxPreview.tsx` | Unificar FINAL PASS para capturar 100% de `___________` sueltos |
| `src/components/tramites/InmuebleForm.tsx` | Ocultar botones de carga si `metadata` ya tiene datos, mostrar badges |
| `src/components/tramites/PersonaForm.tsx` | Banner contextual "Sube Escritura para completar estado civil" |
| `src/components/tramites/ExpedienteSidebar.tsx` | Recibir y ejecutar `onUploadDocument` con invocación de `scan-document` |

5 archivos. Sin migraciones DB. Sin componentes nuevos.

