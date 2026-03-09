

## Plan: Búsqueda Fuzzy con Levenshtein en SelectionToolbar

### Cambio
Reemplazar el filtro `includes()` actual por una función de distancia de Levenshtein que también capture variables con nombres similares aunque no contengan el substring exacto.

### Implementación

**`SelectionToolbar.tsx`**:
1. Agregar función `levenshtein(a, b)` inline (es ~15 líneas, no requiere librería externa).
2. Cambiar la lógica de `suggestions` en el `useMemo`:
   - Primero incluir matches exactos (`includes`) como prioridad alta.
   - Luego agregar matches fuzzy con distancia ≤ 3 (o ratio ≥ 0.6 relativo al largo).
   - Ordenar por distancia ascendente.
   - Deduplicar y limitar a 5 resultados.

```typescript
// Lógica propuesta
const suggestions = useMemo(() => {
  if (!normalizedInput) return [];
  const scored = existingVariables.map(v => ({
    name: v,
    distance: levenshtein(v.toLowerCase(), normalizedInput),
    includes: v.toLowerCase().includes(normalizedInput),
  }));
  return scored
    .filter(s => s.includes || s.distance <= Math.max(3, Math.floor(s.name.length * 0.4)))
    .sort((a, b) => (a.includes === b.includes ? a.distance - b.distance : a.includes ? -1 : 1))
    .slice(0, 5)
    .map(s => s.name);
}, [normalizedInput, existingVariables]);
```

### Archivo
| Archivo | Cambio |
|---------|--------|
| `SelectionToolbar.tsx` | Agregar `levenshtein()`, actualizar lógica de filtrado en `useMemo` |

