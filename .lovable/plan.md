

## Plan: Sugerencias de Variables Existentes al Crear Nueva Variable

### Problema
Cuando el usuario selecciona texto y escribe un nombre de variable en `SelectionToolbar`, no hay feedback sobre variables similares ya existentes. Podría crear duplicados o variables con nombres casi idénticos.

### Solución
Pasar las variables existentes (template + custom) al `SelectionToolbar` y mostrar sugerencias filtradas debajo del input conforme el usuario escribe.

### Cambios

**`SelectionToolbar.tsx`** — Agregar prop `existingVariables: string[]` y renderizar lista de sugerencias:
- Filtrar variables existentes cuyo nombre contenga el texto del input (fuzzy simple con `includes`)
- Mostrar lista debajo del input con botones clickeables para autocompletar
- Si el usuario selecciona una existente, se usa ese nombre (reutiliza la variable)
- Si escribe uno nuevo, se crea normalmente
- Indicador visual: badge "existente" en las sugerencias vs "nueva" si no hay match

**`DocxPreview.tsx`** — Construir lista de variables existentes:
- Combinar las keys del template (FIELD_TO_INMUEBLE, FIELD_TO_ACTOS, campos de persona) con los `variableName` de `customVariables`
- Pasar como prop `existingVariables` al `SelectionToolbar`

**`Validacion.tsx`** — Sin cambios de lógica, la prop se pasa a través de DocxPreview.

### UX del Componente

```text
┌──────────────────────────────────┐
│ Texto: "Juan Pérez López"       │
│ ┌────────────────┐ [✓] [✗]     │
│ │ nombre_v...    │              │
│ └────────────────┘              │
│ Sugerencias:                    │
│  ○ nombre_completo  [existente] │
│  ○ nombre_rep_legal [existente] │
│  ─── o crear nueva ───         │
│  ● nombre_vendedor  [nueva]    │
└──────────────────────────────────┘
```

### Archivos
| Archivo | Cambio |
|---------|--------|
| `SelectionToolbar.tsx` | Agregar prop `existingVariables`, lista de sugerencias filtradas, autocompletado |
| `DocxPreview.tsx` | Construir y pasar `existingVariables` al toolbar |

