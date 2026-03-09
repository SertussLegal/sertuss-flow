

## Corregir alturas del split view

### Problema
El panel izquierdo (DocxPreview) usa `h-full` heredado del `ResizablePanel`, pero el `ResizablePanelGroup` con `flex-1` no tiene una altura explícita acotada. Mientras tanto, el panel derecho usa `h-[calc(100vh-3.5rem)]` en su `ScrollArea`. Esta inconsistencia causa que ambos paneles no coincidan en altura y el diseño se vea roto.

### Solución

1. **`src/pages/Validacion.tsx`**: Cambiar el contenedor raíz de `min-h-screen` a `h-screen` y añadir `overflow-hidden` para que el layout sea fijo al viewport. El `ResizablePanelGroup` con `flex-1` heredará la altura correcta y ambos paneles tendrán exactamente la misma altura.

2. **Panel derecho**: Eliminar el `h-[calc(100vh-3.5rem)]` del `ScrollArea` y usar `h-full` — ya que el panel padre ahora tiene altura definida.

3. **Panel izquierdo**: Ya usa `h-full` via DocxPreview, no necesita cambios.

### Cambios concretos

**`src/pages/Validacion.tsx`**:
- Línea 183: `min-h-screen` → `h-screen overflow-hidden`
- Línea 223: `h-[calc(100vh-3.5rem)]` → `h-full`

Esto asegura que header (3.5rem) + ResizablePanelGroup (flex-1) = 100vh exacto, y ambos paneles comparten la misma altura restante.

