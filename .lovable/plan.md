

## Plan: Smart Audit Mode — Pasos 1 y 2

### Resumen
Añadir animación glow CSS + refactorizar `InlineEditToolbar` con stepper de navegación, chips de sugerencia inteligentes, y triple acción (Solo esta / Todas / Aceptar →).

---

### Paso 1: `src/index.css` — Animación glow

Añadir al final de `@layer utilities`:

```css
@keyframes audit-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0); }
  50% { box-shadow: 0 0 8px 4px rgba(124, 58, 237, 0.4); }
}
.audit-glow {
  animation: audit-glow 1.5s ease-in-out 2;
  border-radius: 2px;
  display: inline;
}
```

---

### Paso 2: `src/components/tramites/InlineEditToolbar.tsx` — Refactor completo

**Props nuevas** (se añaden a las existentes):
```typescript
onApplyAtIndex?: (newText: string, index: number) => void;
onNavigate?: (index: number) => void;
replacements?: Record<string, string>;
existingOverrides?: TextOverride[];
```

**Estado interno nuevo**:
- `currentIndex` — posición actual en el stepper
- `appliedIndices: Set<number>` — índices ya aplicados

**Secciones de la UI** (de arriba a abajo):

1. **Texto original** (sin cambios — truncado a 50 chars)

2. **Stepper** (solo si `occurrenceCount > 1`):
   - Fila: `[←] ●○○●○ 2/5 [→]`
   - Dots: `bg-green-500` si está en `appliedIndices`, `bg-muted-foreground/30` si pendiente, `ring-2 ring-primary` si es el actual
   - Click en flechas → `setCurrentIndex` + `onNavigate(newIndex)`

3. **Input** (sin cambios funcionales)

4. **Chips de sugerencia** (debajo del input, fila scrollable horizontal):
   - `useMemo` con ranking (máx 5, deduplicados, ocultar si coincide con `newText` actual):
     1. **Dato Oficial**: valores de `replacements` cuyo valor contiene `selectedText` (case-insensitive, min 3 chars)
     2. **Override Previo**: overrides existentes cuyo `originalText` incluye `selectedText`
     3. **Smart Case**: `newText.toUpperCase()` y `toTitleCase(newText)` si difieren del input
   - Render: `<button className="text-xs bg-muted/60 hover:bg-muted rounded-full px-2 py-0.5 transition-all duration-200 animate-in fade-in-0">`
   - Click → `setNewText(chipValue)`

5. **Acciones** (3 botones cuando `occurrenceCount > 1`):
   - **"Solo esta"**: `onApply(newText, false)` → cierra
   - **"Todas (N)"**: `onApply(newText, true)` → cierra
   - **"Aceptar →"**: `onApplyAtIndex(newText, currentIndex)` → añade a `appliedIndices` → delay 200ms → avanza al siguiente no-aplicado → `onNavigate(nextIndex)`. Si todos aplicados → toast "Auditoría completa" → cierra
   - Si `occurrenceCount === 1`: solo botón "Aplicar" (sin cambios)

**Cierre con pendientes**: si `appliedIndices.size > 0 && < occurrenceCount` → toast info `"N de M cambios aplicados"`

**Helper `toTitleCase`**: inline function que capitaliza primera letra de cada palabra

---

### Paso 2b: `src/components/tramites/DocxPreview.tsx` — Pasar nuevas props al toolbar

En el render del `InlineEditToolbar` (~línea 1138-1146), añadir:

```typescript
replacements={buildReplacements()}
existingOverrides={overrides}
onNavigate={(index) => setScrollToOccurrence(
  selectionToolbar ? { text: selectionToolbar.text, index } : null
)}
onApplyAtIndex={(newText, index) => {
  if (!selectionToolbar || !onCreateOverride) return;
  // Extract context at specific index using TreeWalker (se implementará en Paso 3)
  onCreateOverride(selectionToolbar.text, newText, false,
    selectionToolbar.contextBefore, selectionToolbar.contextAfter);
}}
```

Añadir estado `scrollToOccurrence`:
```typescript
const [scrollToOccurrence, setScrollToOccurrence] = useState<{text: string; index: number} | null>(null);
```

Memoizar `buildReplacements` — ya está como `useCallback`, se pasa el resultado al toolbar.

**Nota**: El `useEffect` de scroll + glow + TreeWalker se implementa en el Paso 3 (siguiente iteración). En este paso solo se pasa el estado para que compile.

---

### Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/index.css` | Keyframes `audit-glow` |
| `src/components/tramites/InlineEditToolbar.tsx` | Stepper, chips, 3 acciones |
| `src/components/tramites/DocxPreview.tsx` | Nuevas props al toolbar + estado scroll |

3 archivos. Sin migraciones. Sin dependencias nuevas.

