

## Corrección definitiva del layout split view

### Problemas identificados

1. **Scroll infinito del body**: El `ResizablePanel` del preview no tiene `overflow-hidden`, permitiendo que el contenido escalado desborde hacia el body.
2. **Documento cortado arriba**: El contenedor usa `items-center justify-center` pero cuando la página escalada es más alta que el espacio disponible, se corta por arriba y abajo sin posibilidad de scroll.
3. **Sin scroll interno en el preview**: El panel del documento usa `overflow-hidden` rígido — si la página no cabe, simplemente se corta.

### Solución

**Modo híbrido**: Una página a la vez (paginación), pero con scroll interno cuando la página escalada no cabe en el panel.

**`src/pages/Validacion.tsx`**:
- Añadir `overflow-hidden` a cada `ResizablePanel` para contener el desbordamiento
- En mobile (< lg), permitir scroll global del body envolviendo todo en un layout de columna con scroll

**`src/components/tramites/DocxPreview.tsx`**:
- Cambiar el contenedor de la página de `overflow-hidden` a `overflow-auto` para permitir scroll cuando la página escalada no cabe
- Cambiar `items-center justify-center` a `items-start justify-center` con padding top para evitar que el contenido se corte por arriba
- Mantener la paginación intacta

### Resultado esperado
- Desktop: sin scroll del body, cada panel contenido, preview con scroll interno si la página no cabe
- Mobile: layout en columna con scroll natural del navegador
- La barra de navegación de páginas siempre visible al fondo del panel

