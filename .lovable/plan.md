

## Plan: Edición Semántica por Anclaje — Con Mapa de Conflictos de Variables

### Contexto: Los 3 sistemas de variables actuales

```text
Sistema 1: Template Variables {llaves}
  - Origen: plantilla DOCX con {nombre_variable}
  - Pipeline: buildReplacements() → 60+ campos → regex {key} → <span data-field>
  - Edición: click → VariableEditPopover → handleFieldEdit → actualiza estado React
  - DOCX: Docxtemplater resuelve antes de que overrides actúen
  - PRIORIDAD: 1 (máxima)

Sistema 2: Custom Variables (SE ELIMINA)
  - Origen: usuario selecciona texto libre → nombra variable
  - Pipeline: regex global sobre originalText → <span data-custom-var>
  - Edición: click → VariableEditPopover vía __custom__${id}
  - DOCX: split().join() sobre XML crudo (frágil)
  - Persistencia: metadata.custom_variables

Sistema 3: Sugerencias IA
  - Origen: SERTUSS-EDITOR-PRO genera SugerenciaIA[]
  - Pipeline: resaltado naranja <mark data-sugerencia-idx>
  - Acción: Aceptar → handleSugerenciaAccepted → actualiza campo + textoFinalWord
  - NO persisten como overrides — se eliminan al aceptar
```

### Conflictos identificados y resoluciones

| Conflicto | Detalle | Resolución |
|---|---|---|
| Override sobre template var | Usuario selecciona texto que es un `{vendedor_nombre}` ya resuelto | `handleMouseUp` detecta `data-field` en el elemento padre → no abre InlineEditToolbar, abre VariableEditPopover |
| Override sobre sugerencia IA | Usuario selecciona texto resaltado naranja | `handleMouseUp` detecta `data-sugerencia-idx` → no abre InlineEditToolbar |
| Override sobre otro override | Usuario selecciona texto ya overrideado (púrpura) | `handleMouseUp` detecta `data-override` → abre VariableEditPopover para editar el override existente (no crear uno nuevo) |
| `handleFieldEdit` routing | Hoy usa `__custom__` prefix para custom vars | Cambiar a `__override__` prefix; misma lógica pero actualiza `overrides` array |
| Orden de aplicación HTML | Custom vars se aplican después de template vars (línea 669) | Overrides se aplican en la misma posición — después de template vars, antes de sugerencias IA |
| DOCX `split().join()` | Operación frágil que no respeta nodos XML | Reemplazar con algoritmo de virtualización de `<w:t>` nodes |
| Persistencia key | `metadata.custom_variables` en 3 sitios (líneas 193, 624, 1157) | Cambiar las 3 a `metadata.overrides` + fallback migración en loadTramite |
| `buildReplacements` timing | Template vars se resuelven primero (línea 648) | Sin cambio — overrides operan sobre texto libre que queda DESPUÉS de que las template vars se resuelven |
| `DOMPurify` bloquea atributos | `data-override` no está en `ALLOWED_ATTR` (línea 152) | Añadir `"data-override"` al array |

### Paso 1: `src/lib/types.ts`

- Eliminar `CustomVariable` interface
- Añadir `TextOverride` con `id`, `originalText`, `newText`, `contextBefore`, `contextAfter`, `replaceAll`, `createdAt`

### Paso 2: `src/components/tramites/InlineEditToolbar.tsx` (nuevo)

- Input directo: texto seleccionado + campo reemplazo + Enter
- Validación: rechaza si contiene `{` y `}` (toast redirige a formulario)
- Validación: rechaza si >300 chars (toast)
- Si ocurrencias >1: botones "Solo esta" / "Todas (N)"
- Props: `selectedText`, `position`, `occurrenceCount`, `onApply(newText, replaceAll)`, `onClose`

### Paso 3: `src/components/tramites/DocxPreview.tsx`

**Props**: reemplazar `customVariables/onCreateCustomVariable` → `overrides/onCreateOverride/onRemoveOverride`

**DOMPurify**: añadir `"data-override"` a `ALLOWED_ATTR`

**Pipeline** (líneas 669-678): Reemplazar bloque de custom variables:
- `replaceAll: true` → regex global, wrap en `<span data-override="id">` con estilo púrpura (distinto del verde de template vars)
- `replaceAll: false` → buscar con contexto normalizado; fallback a primera ocurrencia
- **Pipeline puro**: todo el bloque 626-716 se mueve a `useMemo` con deps `[baseHtml, vendedores, compradores, inmueble, actos, overrides, sugerenciasIA, slotsPendientes]` → elimina el debounce manual

**`handleContentClick`** (línea 784): `data-custom-var` → `data-override`, buscar en `overrides`, field prefix `__override__`

**`handleMouseUp`** (línea 801):
- Extraer `contextBefore`/`contextAfter` (40 chars) del Range
- Guardia: si `anchorEl` tiene `data-field` OR `data-override` OR `data-sugerencia-idx` → no abrir toolbar
- Contar ocurrencias del texto en el textContent del contenedor
- Abrir `InlineEditToolbar` en vez de `SelectionToolbar`

**Panel "Cambios"** en barra de navegación: botón `Cambios (N)` con Popover listando overrides + botón Deshacer

### Paso 4: `src/pages/Validacion.tsx`

**Estado** (línea 86): `customVariables` → `overrides: TextOverride[]`

**`loadTramite`** (línea 193): leer `meta.overrides` con fallback de migración:
```
if meta.overrides → setOverrides
else if meta.custom_variables → convertir cada CV a TextOverride con replaceAll:true, contexto vacío
```

**`handleCreateOverride`** (reemplaza línea 1038): crea TextOverride y añade al array

**`handleRemoveOverride`**: filtra por id, toast "Cambio deshecho"

**`handleFieldEdit`** (línea 680): `__custom__` → `__override__`, actualiza `overrides` array

**Persistencia** (líneas 624, 1157): `custom_variables` → `overrides`

**`handleDownloadWord`** (líneas 1556-1567) — Algoritmo robusto:
1. Extraer nodos `<w:t>` con regex, construir texto plano virtualizado con mapa de posiciones
2. Para cada override: buscar en texto plano (con normalización whitespace)
3. Mapear posición encontrada a nodos `<w:t>` afectados
4. Consolidar: poner `newText` (XML-escaped) en primer nodo, vaciar contenido de los demás
5. Reconstruir XML

**Props JSX**: actualizar todas las refs a `customVariables` → `overrides` y callbacks correspondientes

### Paso 5: Eliminar `src/components/tramites/SelectionToolbar.tsx`

---

### Diferenciación visual (UX)

```text
Template var resuelta:  verde #065f46, borde dashed verde, data-field
Template var pendiente: fondo rojo/naranja, subrayado, data-field
Override del usuario:   púrpura #4c1d95, borde dashed #7c3aed, data-override
Sugerencia IA:          naranja <mark>, data-sugerencia-idx
```

### Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/lib/types.ts` | Eliminar `CustomVariable`, añadir `TextOverride` |
| `src/components/tramites/InlineEditToolbar.tsx` | Nuevo componente |
| `src/components/tramites/SelectionToolbar.tsx` | Eliminar |
| `src/components/tramites/DocxPreview.tsx` | Props, override pipeline con useMemo, panel cambios |
| `src/pages/Validacion.tsx` | Estado, handlers, persistencia, algoritmo DOCX robusto |

5 archivos. Sin migraciones DB. Sin edge functions.

