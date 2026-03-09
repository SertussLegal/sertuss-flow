

## Previsualización responsiva al panel

### Problema
Las páginas tienen ancho fijo de 612px. Si el panel izquierdo se redimensiona a menos de ~640px, aparece scroll horizontal. Si es más ancho, queda mucho espacio vacío.

### Solución
Usar `ResizeObserver` para medir el ancho disponible del contenedor y calcular un factor de escala (`scale = containerWidth / PAGE_WIDTH`). Aplicar `transform: scale(scale)` con `transform-origin: top center` al wrapper de cada página, manteniendo las dimensiones internas fijas (612×792px) para que la paginación siga funcionando correctamente.

### Cambios en `src/components/tramites/DocxPreview.tsx`

1. Añadir `containerRef` + estado `scale` 
2. `useEffect` con `ResizeObserver` en el contenedor padre que calcula `scale = Math.min(1, (width - 32) / PAGE_WIDTH)` (32px = padding lateral)
3. Cada página se envuelve en un div con `transform: scale(${scale})` y `transform-origin: top center`
4. El contenedor de cada página usa `height` escalada para evitar gaps: `height: PAGE_HEIGHT * scale`
5. El div de medición oculto mantiene ancho fijo (no se escala)

### Resultado
- Panel ancho: páginas a escala 1:1 (máximo 612px)
- Panel estrecho: páginas se reducen proporcionalmente sin scroll horizontal
- La paginación y márgenes internos se mantienen correctos

