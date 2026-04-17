

## Plan revisado: Datos de notaría siempre vacíos + sugerencias one-click vía Claude

### Componente reutilizable encontrado

Sí, ya existe — y de hecho hay **dos** componentes complementarios que encajan perfectamente:

**1. `src/components/tramites/VariableEditPopover.tsx`** — Popover flotante posicionado (`fixed`, top/left calculados) que se ancla sobre cualquier texto/campo. Muestra label del campo + input editable + botones Aceptar (✓) / Cancelar (✗). Cierra con click-outside o Escape. Ya lo usa el flujo de edición inline del preview.

**2. `src/components/tramites/OcrSuggestion.tsx`** — Popover sobre un trigger (`<children>`), muestra el valor sugerido con dos acciones: **Confirmar** / **Ignorar**. Hoy se usa para sugerencias OCR, pero su contrato (`value`, `onConfirm`, `onIgnore`, `children`) es exactamente lo que necesitamos para sugerencias de Claude.

**Decisión**: usar **`OcrSuggestion`** (one-click confirmar/ignorar) como UX principal para las sugerencias de Claude sobre datos de notaría, y **`VariableEditPopover`** como fallback "Editar manualmente" si el usuario quiere escribir un valor distinto al sugerido.

### Cambios al plan original

**A) Pre-llenado eliminado**
- En `Validacion.tsx`, el state `notariaTramite` arranca con TODOS los campos en `""` (vacíos).
- NO se hidrata desde `notariaConfig`, `configuracion_notaria`, `notaria_styles`, ni `profile.organization`.
- Solo se hidrata desde `tramites.metadata.notaria_tramite` si el usuario ya editó algo en ese trámite específico (persistencia, no pre-llenado).

**B) Preview siempre con líneas en blanco por defecto**
- En `DocxPreview.tsx`, el mapa de placeholders devuelve `___________` para cada campo de notaría vacío. Sin fallback a `notariaConfig`.
- El template `.docx` igualmente se parametriza (4 ubicaciones: encabezado calificación, intro, cierre minuta, pie de página) — el `nullGetter` de Docxtemplater rellena con `___________` si el campo está vacío en `templateData`.

**C) Sugerencias de Claude (Momento 1) → one-click**
- La edge function `validar-con-claude` ya soporta `auto_corregible: true` con `valor_sugerido`. Las reglas `COH_TEMPLATE_VS_ESCRITURA_PREVIA` y `CTX_TEMPLATE_NOTARIA_INFO` ya están activas y pueden detectar datos de notaría en documentos cargados.
- Filtrar las validaciones devueltas por `campo` que empiece con `notaria_tramite.` o `notaria.` y `auto_corregible === true`.
- Renderizar cada una en el panel "Datos de la Notaría" como un `<OcrSuggestion>` envolviendo el input correspondiente:
  - **Confirmar** → `setNotariaTramite({ ...prev, [campo]: valor_sugerido })` + persistir en metadata + remover esa sugerencia del state local.
  - **Ignorar** → solo remover esa sugerencia del state local (no toca el input).
  - Botón secundario "Editar" → abre `VariableEditPopover` para escribir un valor custom.

**D) Banner de resumen**
- En el banner colapsable existente (Momento 1), agregar una sección "Sugerencias de notaría detectadas (N)" con botón "Aplicar todas" que itera y aplica los `valor_sugerido` de todas las validaciones `auto_corregible` con `campo` de notaría.

**E) Reglas de Claude — refuerzo en el prompt**
- En `validar-con-claude/index.ts`, agregar al `systemPrompt` una instrucción explícita: *"Cuando detectes datos de notaría (número, círculo, nombre del notario, decreto, tipo) en los documentos cargados, repórtalos como sugerencias `auto_corregible: true` con `campo` = `notaria_tramite.<nombre>` y `valor_sugerido` = valor extraído. NO los reportes como errores — el usuario puede no querer usar esa notaría. Son solo sugerencias."*

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `public/template_venta_hipoteca.docx` | 4 reemplazos de texto hardcodeado → placeholders |
| `src/pages/Validacion.tsx` | State `notariaTramite` siempre vacío, panel UI con `OcrSuggestion` por campo, persistencia en metadata, paso a `DocxPreview` |
| `src/components/tramites/DocxPreview.tsx` | Mapa de placeholders extendido, helpers `deriveFemenino` y `toProperCase`, fallback `___________` sin recurrir a `notariaConfig` |
| `supabase/functions/validar-con-claude/index.ts` | Instrucción adicional en `systemPrompt` para sugerencias de notaría auto-corregibles |
| `supabase/functions/process-expediente/index.ts` | Inyectar `notaria_tramite` al prompt de Gemini con instrucción "líneas en blanco si vacío" |
| `supabase/functions/generate-document/index.ts` | Idem |

### Reglas críticas

- **Cero pre-llenado**: campos vacíos hasta que el usuario actúe.
- **Cero datos de Notaría Quinta** en el preview por defecto — solo `___________`.
- **One-click para aceptar**: `OcrSuggestion` ya da exactamente esa UX.
- **Edición manual disponible**: `VariableEditPopover` como fallback.
- **Persistencia por trámite**: `tramites.metadata.notaria_tramite`, no global.

### Riesgos

Bajo. Los dos componentes (`OcrSuggestion`, `VariableEditPopover`) ya están en producción y probados. Si Claude no devuelve sugerencias, los campos simplemente quedan vacíos y el preview muestra `___________` — estado seguro.

