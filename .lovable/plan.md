

## Plan: Corrección de Bugs — Placeholders, Layout, Chips y Wording

### Archivo 1: `src/components/tramites/DocxPreview.tsx` — Filtro de placeholders

En `handleMouseUp` (línea 913), después del check de longitud, añadir:

```typescript
// Block purely decorative selections (only underscores, dots, dashes, spaces)
if (!/[a-zA-Z0-9áéíóúñÁÉÍÓÚÑ]/.test(text)) return;
```

Esto permite cualquier selección que tenga al menos un carácter alfanumérico (incluyendo tildes), pero bloquea `___________`, `...`, `---`, etc.

### Archivo 2: `src/components/tramites/InlineEditToolbar.tsx` — 3 correcciones

**a) Chips con tipado inteligente** (líneas 145-192):

Reescribir el `useMemo` de chips:
- Detectar si `selectedText` es numérico: `const isNumeric = /^\d[\d.,]*$/.test(selectedText.trim())`
- Para **Dato Oficial**: si `isNumeric`, priorizar valores de `replacements` que sean numéricos (cédulas, matrículas, valores). Si es texto, priorizar nombres/direcciones.
- Añadir filtro de relevancia mínima: el valor del replacement debe tener al menos 40% de overlap con `selectedText` O viceversa (no solo `includes` con 3 chars genéricos).
- Excluir placeholders del matching: `if (!val || /^[_.\-\s]+$/.test(val)) continue;`
- Early return si `selectedText` es decorativo: `if (!/[a-zA-Z0-9]/.test(selectedText)) return [];`

**b) Layout de botones** (líneas 306-345):

Cambiar de `flex gap-1.5` a layout de 2 filas:

```text
Fila 1 (solo si newText tiene contenido):
  [Cambiar esta]  [Cambiar todas (N)]

Fila 2 (siempre visible si isAuditMode):
  [       Aplicar y Siguiente →        ]  (ancho completo, disabled si !newText)
```

Si `!newText.trim()`, la fila 1 no se muestra — solo queda el stepper de navegación arriba para explorar ocurrencias sin ruido.

**c) Wording**:
- "Solo esta" → "Cambiar esta"
- "Todas (N)" → "Cambiar todas (N)"
- "Aceptar →" → "Aplicar y Siguiente"
- Quitar icono `Check` de "Cambiar esta", dejar `Replace` en "Cambiar todas"
- Botón principal "Aplicar y Siguiente" mantiene `ArrowRight`

### Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | Filtro alfanumérico en `handleMouseUp` |
| `src/components/tramites/InlineEditToolbar.tsx` | Chips tipados, layout 2 filas, wording |

2 archivos. Sin migraciones. Sin dependencias.

