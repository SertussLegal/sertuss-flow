

## Plan aprobado — Implementación raíz de sincronización reactiva

### Cambios

**1. `src/pages/Validacion.tsx`**
- Añadir estado `manualFieldOverrides: Record<string, string>` con su setter.
- Hidratar desde `metadata.manualFieldOverrides` al cargar trámite.
- Persistir en `metadata.manualFieldOverrides` dentro del auto-guardado existente (junto a `overrides`).
- En `handleFieldEdit(field, value, anchorText?)`:
  - Aplicar `normalizeFieldCasing` (ya existe).
  - Si cae en `FIELD_TO_INMUEBLE` / `FIELD_TO_ACTOS` / `__override__*` → comportamiento actual intacto.
  - **Else** (campo no mapeado): `setManualFieldOverrides(prev => ({ ...prev, [field]: v }))`. **Eliminar** la llamada actual a `handleCreateOverrideRef.current?.(anchorText, v, …)` que es el origen del bug regex.
- Pasar `manualFieldOverrides` como prop a `<DocxPreview>`.

**2. `src/components/tramites/DocxPreview.tsx`**
- Nueva prop `manualFieldOverrides?: Record<string, string>`.
- En `buildReplacements`: `return { ...replacements, ...manualFieldOverrides }` (precedencia: usuario gana).
- Reducir debounce de `setTimeout(…, 500)` → `setTimeout(…, 80)` en el pipeline de re-render.
- En el loop de render de spans: si `key in manualFieldOverrides` → clase `var-user-edited` (púrpura), sino mantener `var-resolved` (verde OCR/form) o `var-pending` (rojo vacío).

**3. `src/index.css`**
- Añadir:
```css
.var-user-edited {
  color: #6d28d9;
  background: #f5f3ff;
  border-radius: 2px;
  padding: 0 2px;
  transition: color 200ms ease, background-color 200ms ease;
}
.var-pending, .var-resolved {
  transition: color 200ms ease, background-color 200ms ease;
}
```

### Verificación
1. `notaria_circulo` rojo → "bogota" → ✓ → **BOGOTÁ púrpura** en <100ms.
2. `escritura_numero` → "1234" → púrpura, sin upper.
3. `inmueble.matricula` → verde (mapeado, persiste en BD).
4. Recarga página → valores manuales persisten desde `metadata.manualFieldOverrides`.
5. `handleCreateOverride` sigue exclusivo para selecciones de texto del visor (`InlineEditToolbar`).

### Archivos modificados (3)
- `src/pages/Validacion.tsx`
- `src/components/tramites/DocxPreview.tsx`
- `src/index.css`

### Riesgos
Mínimos. Se elimina un mecanismo frágil (regex sobre `___________` indistinguibles) y se reemplaza por el path canónico de `replacements`. Comportamiento de campos mapeados intacto.

