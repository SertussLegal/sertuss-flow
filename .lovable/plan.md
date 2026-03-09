

## Diagnóstico y corrección del layout split view

### Problemas encontrados

1. **Typo crítico en línea 183 de Validacion.tsx**: `overflow-hiddenrflow-hidden` — esto invalida la clase CSS, por lo que `overflow-hidden` nunca se aplica. El body puede hacer scroll infinito hacia abajo mostrando blanco.

2. **ResizablePanelGroup sin overflow-hidden**: El grupo de paneles con `flex-1` no restringe el desbordamiento de sus hijos, permitiendo que el contenido se extienda más allá del viewport.

3. **DocxPreview cortado por arriba**: La página del documento comienza pegada al borde superior sin margen respecto al header. El contenido se ve cortado.

### Cambios

**`src/pages/Validacion.tsx`** (2 correcciones):
- Línea 183: Corregir typo `overflow-hiddenrflow-hidden` → `overflow-hidden`
- Línea 210: Añadir `overflow-hidden` al `ResizablePanelGroup` para que ambos paneles queden contenidos: `className="flex-1 overflow-hidden"`

**`src/components/tramites/DocxPreview.tsx`**:
- Sin cambios estructurales necesarios. El componente ya tiene `h-full`, nav bar fija, y escalado dual. El problema era que el contenedor padre no restringía la altura.

### Resultado esperado
- El layout queda bloqueado a `100vh` (header 56px + paneles el resto)
- El documento se centra vertical y horizontalmente dentro de su panel sin cortarse
- El formulario tiene scroll interno solo dentro de su contenido
- No hay scroll en el body ni espacio en blanco debajo

