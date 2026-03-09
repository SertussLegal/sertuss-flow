

## Plan: Reestructuración "Validación Humana + IA"

### Análisis: ¿Qué ya existe vs qué falta?

**Ya implementado:**
- Split View con ResizablePanelGroup
- DocxPreview reactivo con mammoth y navegación por páginas
- Formularios completos: Personas (Apoderado, Municipio), Inmueble (CHIP/Cédula, ORIP, PH), Actos (Hipoteca)
- OCR con scan-document Edge Function (6 tipos de documento)
- Badges OCR que desaparecen al editar manualmente
- Consumo/rollback de créditos
- Validación de NIT/Razón Social para generación
- Campos editables, nacen vacíos

**Falta implementar (3 features nuevos):**

### 1. Prevención de Sobreescritura OCR con Popover de Sugerencia

Cuando un campo ya tiene contenido (editado manualmente o por OCR previo), el OCR no debe sobreescribirlo directamente. En su lugar, muestra un Popover junto al campo con el valor detectado y botones "Confirmar" / "Ignorar".

**Nuevo componente: `src/components/tramites/OcrSuggestion.tsx`**
- Popover que se abre automáticamente mostrando el valor detectado por OCR
- Botón "Confirmar": aplica el valor y marca como OCR
- Botón "Ignorar": cierra el popover sin cambios
- Se auto-cierra si el usuario edita manualmente el campo

**Cambios en `InmuebleForm.tsx`, `PersonaForm.tsx`, `ActosForm.tsx`:**
- Estado `suggestions: Map<string, string>` para almacenar sugerencias pendientes
- Lógica: si `campo.length > 0` al recibir OCR → agregar a `suggestions` en vez de aplicar directamente
- Wrapper en cada campo: si tiene sugerencia pendiente, renderizar `<OcrSuggestion>` junto al input
- Al confirmar: aplicar valor + marcar OCR + remover sugerencia
- Al ignorar: solo remover sugerencia

### 2. Resaltado Visual en DocxPreview

Variables que aún son placeholder (`___________`) se muestran con un subrayado amarillo sutil para indicar que requieren validación humana. Variables ya resueltas se muestran en negrita sin resaltado.

**Cambios en `DocxPreview.tsx`:**
- Cambiar debounce de 300ms → 500ms
- Valores resueltos (no vacíos): `<strong class="resolved">${value}</strong>`
- Valores vacíos/placeholder: `<mark class="pending">___________</mark>`
- Agregar estilos inline: `.pending { background: #fef3c7; text-decoration: underline; }` y `.resolved { color: #065f46; }`

### 3. Persistencia en metadata JSONB

Guardar el tracking de campos OCR y ediciones manuales en la columna `metadata` de `tramites` al hacer "Guardar".

**Cambios en `Validacion.tsx`:**
- La tabla `tramites` ya tiene columna `metadata` (tipo JSONB, no nullable, default `'{}'`)

Espera — revisando la tabla... `tramites` no tiene columna `metadata`. Necesitamos una migración.

**Migración SQL:** Agregar columna `metadata jsonb default '{}'::jsonb` a `tramites`.

**En `handleSave`:** Incluir `metadata: { ocr_fields: [...], manual_edits: [...], last_saved: timestamp }` al insertar/actualizar el trámite.

### Resumen de archivos

| Archivo | Cambio |
|---------|--------|
| `src/components/tramites/OcrSuggestion.tsx` | **Nuevo** — Popover de sugerencia OCR |
| `src/components/tramites/InmuebleForm.tsx` | Lógica de sugerencias + props |
| `src/components/tramites/PersonaForm.tsx` | Lógica de sugerencias + props |
| `src/components/tramites/ActosForm.tsx` | Lógica de sugerencias + props |
| `src/components/tramites/DocxPreview.tsx` | Resaltado visual + debounce 500ms |
| `src/pages/Validacion.tsx` | Persistencia metadata |
| Migración SQL | Agregar `metadata` a `tramites` |

### Nota sobre "Edición In-Situ"

La funcionalidad de seleccionar texto en el visor Word para convertir palabras en variables es una feature compleja que requiere un editor de contenido con selección de rangos, mapping bidireccional entre HTML y template tags, y sincronización con el objeto de datos. Recomiendo implementarlo como fase separada después de validar las 3 features de arriba.

