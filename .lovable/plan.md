

## Previsualización tipo Word con páginas reales

### Problema actual
El documento se renderiza como un bloque continuo sin paginación — no se parece a un documento Word real. Falta separación en páginas, márgenes consistentes y fondo gris entre páginas.

### Solución

Dividir el HTML renderizado en "páginas" simuladas con dimensiones proporcionales a una hoja carta (Letter: 8.5 × 11in) y presentarlas apiladas verticalmente con separación visual.

**Enfoque**: Usar CSS `columns` o JS para paginar el contenido dentro de contenedores con altura fija. La opción más robusta es renderizar todo el HTML dentro de un contenedor con CSS `break-after: page` y usar un `ref` + `useEffect` para dividir el contenido en páginas de altura fija (≈1056px para simular 11in a 96dpi).

**Enfoque simplificado y robusto**: Usar CSS puro con `column-fill` no funciona bien con prose. Mejor: renderizar el HTML en un div oculto, medir su altura total, y crear N páginas con `overflow: hidden` + `transform: translateY` para mostrar la porción correcta de cada página.

### Cambios en `src/components/tramites/DocxPreview.tsx`

1. **Fondo gris** entre páginas — el contenedor padre usa `bg-gray-200`
2. **Páginas con aspecto Letter** — cada "página" es un div blanco con aspect ratio ~8.5:11, padding tipo Word (1in = ~96px margins), sombra
3. **Paginación por medición**: Usar un `ref` en un div oculto para medir la altura total del contenido, luego dividir en páginas usando `overflow: hidden` y posicionamiento
4. **Márgenes simétricos** izquierda/derecha dentro de cada página

### Estructura visual

```text
┌─────────── ScrollArea (bg-gray-200) ────────────┐
│  ┌──────── Página 1 (bg-white, shadow) ────────┐ │
│  │  ┌─── contenido (margins 96px) ───┐         │ │
│  │  │  REPÚBLICA DE COLOMBIA...      │         │ │
│  │  │  ESCRITURA PÚBLICA...          │         │ │
│  │  └────────────────────────────────┘         │ │
│  └─────────────────────────────────────────────┘ │
│                    24px gap                       │
│  ┌──────── Página 2 (bg-white, shadow) ────────┐ │
│  │  ┌─── contenido continuación ─────┐         │ │
│  │  │  ...                           │         │ │
│  │  └────────────────────────────────┘         │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Implementación

- Ancho de página: `612px` (8.5in × 72dpi) escalado al contenedor
- Alto de página: `792px` (11in × 72dpi)
- Padding interno: `72px` top/bottom, `72px` left/right (1 pulgada)
- Área de contenido por página: `468px × 648px`
- Renderizar el HTML completo en un div medible con `ref`, calcular cuántas páginas se necesitan, y mostrar cada "ventana" de contenido con `clip` + offset
- Fondo del contenedor: `bg-muted` (gris claro)
- Cada página: `bg-white rounded shadow-md`
- Gap entre páginas: `24px`

