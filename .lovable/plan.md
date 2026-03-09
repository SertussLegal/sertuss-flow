

## Previsualización una página a la vez con scroll independiente

### Problema
Actualmente el `DocxPreview` muestra todas las páginas apiladas verticalmente en un `ScrollArea`. Ambos paneles ocupan `h-[calc(100vh-3.5rem)]` pero el panel izquierdo no tiene esa altura explícita — hereda `h-full` del `ResizablePanel`. Las páginas se ven pequeñas y amontonadas.

### Solución
Cambiar `DocxPreview` para mostrar **una sola página a la vez** con controles de navegación (anterior/siguiente + indicador "Página X de N"). La página ocupará todo el alto disponible del panel, escalándose para ajustarse tanto al ancho como al alto del contenedor.

### Cambios

**`src/components/tramites/DocxPreview.tsx`**:

1. Añadir estado `currentPage` (0-indexed) con botones prev/next
2. Cambiar el render: mostrar solo la página `currentPage` en vez de mapear todas
3. Escalar la página para ajustarse al viewport disponible: `scale = Math.min((width - 32) / PAGE_WIDTH, (height - 80) / PAGE_HEIGHT)` — los 80px reservan espacio para la barra de navegación
4. Centrar la página vertical y horizontalmente con flexbox
5. Barra de navegación inferior fija con: botón ← | "Página 1 de 5" | botón →
6. Eliminar el `ScrollArea` exterior — ya no se necesita scroll vertical
7. El contenedor raíz pasa a ser `flex flex-col h-full bg-muted`

### Estructura visual

```text
┌──────── Panel izquierdo (h-full) ────────┐
│                                          │
│         ┌── Página actual ──┐            │
│         │                   │            │
│         │   contenido...    │            │
│         │                   │            │
│         └───────────────────┘            │
│                                          │
│    ◀  Página 2 de 5  ▶                   │
└──────────────────────────────────────────┘
```

**`src/pages/Validacion.tsx`**: Sin cambios — la altura ya está correctamente definida por el `ResizablePanelGroup` con `flex-1`.

