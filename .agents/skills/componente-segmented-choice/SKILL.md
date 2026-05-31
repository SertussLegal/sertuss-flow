---
name: componente-segmented-choice
description: Cuándo y cómo usar el componente reutilizable SegmentedChoice para selecciones binarias o ternarias (género gramatical, tratamiento de entidad, sí/no notarial). Patrón visual diferenciado estilo iOS para que el usuario perciba opciones, no botones de acción.
type: design
---

# `SegmentedChoice` — control segmentado reutilizable

Componente en `src/components/shared/SegmentedChoice.tsx`. Wrapper sobre shadcn `ToggleGroup` con estilo de píldora segmentada (estilo iOS): contenedor con borde + fondo `muted/40`, segmento activo elevado (`bg-background` + `shadow-sm` + borde).

## 1. Cuándo usarlo

- Género gramatical de una persona (M / F).
- Tratamiento notarial de una entidad jurídica ("La entidad" / "El establecimiento bancario").
- Cualquier selección **binaria o ternaria** donde las dos opciones sean comparables y mutuamente excluyentes, y donde un `Select` resulte excesivo.

## 2. Cuándo NO usarlo

- 4+ opciones → usar `Select` o `RadioGroup`.
- Acciones (Guardar / Cancelar / Eliminar) → usar `Button`.
- Estados booleanos visibles/ocultos → usar `Switch`.
- Filtros multi-selección → usar `ToggleGroup type="multiple"` directo.

## 3. API

```tsx
<SegmentedChoice
  label="Género del deudor"            // opcional, va arriba
  options={[                            // 2 a 3 opciones
    { value: "M", label: "Masculino" },
    { value: "F", label: "Femenino" },
  ]}
  value={genero}                        // T | ""
  onChange={setGenero}                  // permite deseleccionar a ""
  helper="Si hay duda, déjelo vacío para usar 'el(la) señor(a)'."
  size="sm"                             // "sm" (default) | "md"
  ariaLabel="Género del deudor"         // fallback si no hay label
/>
```

## 4. Reglas de uso

- **Permitir deseleccionar a `""`** cuando el flujo notarial admite incertidumbre (ver skill `concordancia-genero-minutas`). El componente lo hace por defecto.
- Usar `helper` para explicar consecuencias notariales (qué se renderiza cuando queda vacío).
- No envolver en `Card` adicional; ya tiene su propio contenedor visual.
- Mantener etiquetas cortas (1–3 palabras). Para textos largos usar `Select`.

## 5. Accesibilidad

- El componente expone `aria-label` (del prop o del `label`).
- Focus visible con `ring-2 ring-ring` en cada segmento.
- Keyboard: flecha izquierda/derecha cambia selección, espacio/enter activa.
- Contraste de segmento activo sobre el contenedor cumple WCAG 2.1 AA en tema oscuro Sertuss.

## 6. Diferenciación visual

El estilo es deliberadamente distinto del `Button` para evitar que el usuario confunda una opción con una acción:

| Elemento | Apariencia |
|---|---|
| Contenedor | `rounded-lg border border-border bg-muted/40 p-0.5 shadow-sm` |
| Segmento inactivo | `text-muted-foreground hover:bg-background/60` |
| Segmento activo | `bg-background text-foreground shadow-sm + border` |

No alterar estos tokens sin revisar el resto de pantallas — el patrón debe ser idéntico en todo el producto.

## 7. Anti-ejemplos

- ❌ Reimplementar un `ToggleGroup` inline en una nueva pantalla.
- ❌ Usar `Button variant="outline"` + `Button variant="default"` simulando segmentos (se confunde con CTA).
- ❌ Forzar selección obligatoria cuando la regla de negocio admite incertidumbre.
