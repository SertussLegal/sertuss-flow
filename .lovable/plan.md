

## Análisis de contraste — Botón "Guardar"

### Problema

El botón en línea 191 usa `variant="outline"` con clases override: `border-white/20 text-white hover:bg-white/10`. La variante `outline` tiene estilos base `bg-background hover:bg-accent hover:text-accent-foreground` — el fondo es `hsl(var(--background))` que en modo claro es casi blanco. Al aplicar `text-white` sobre un fondo claro implícito, el texto es invisible hasta que los overrides de CSS ganan especificidad. Además, en hover el `bg-accent` (dorado) compite con `hover:bg-white/10`, generando inconsistencia.

### Solución

Usar `variant="ghost-dark"` — ya existe en el design system exactamente para botones con texto blanco sobre fondo oscuro (`text-white hover:bg-white/[0.15]`). Es el mismo que usa el botón "Dashboard" de al lado. Solo hay que añadir el borde para diferenciarlo visualmente como acción secundaria.

### Cambio en `src/pages/Validacion.tsx` (línea 191)

```tsx
// Antes
<Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="border-white/20 text-white hover:bg-white/10">

// Después
<Button variant="ghost-dark" size="sm" onClick={handleSave} disabled={saving} className="border border-white/30">
```

Esto garantiza:
- Texto blanco puro sobre fondo `notarial-dark` — ratio de contraste >15:1
- Hover consistente con `bg-white/[0.15]`
- Borde sutil para distinguirlo del botón "Dashboard" (que no tiene borde)
- Cero overrides de color — usa el sistema de variantes correctamente

