

## Plan: Paginación Real con CSS Multi-Column (Sin Corte de Texto)

### Problema

El visor actual usa un div continuo con `translateY(-${page * CONTENT_HEIGHT}px)` y `overflow: hidden`. Esto corta líneas a la mitad en los bordes de página porque el corte es por píxeles arbitrarios, no por líneas completas.

### Solución: CSS Multi-Column

En vez de un div vertical con translate, usamos **CSS `columns`** nativo del navegador. El browser se encarga de distribuir el contenido en columnas de altura fija, respetando los saltos de línea naturales. Cada "columna" = una "página".

```text
Antes (translateY):
┌─────────┐
│ línea 1  │
│ línea 2  │
│ lin---   │ ← CORTADA
└─────────┘

Después (CSS columns):
┌─────────┐  ┌─────────┐
│ línea 1  │  │ línea 4  │
│ línea 2  │  │ línea 5  │
│ línea 3  │  │ línea 6  │
│          │  │          │
└─────────┘  └─────────┘
  Página 1     Página 2
```

### Cambios en `DocxPreview.tsx`

**1. Contenedor de contenido (líneas 1114-1128):**

Reemplazar el div con `translateY` por un contenedor con CSS columns + `translateX`:

```typescript
// El contenedor externo sigue con overflow: hidden y altura fija
<div style={{ height: `${CONTENT_HEIGHT}px`, overflow: "hidden" }}>
  <div
    ref={contentRef}
    className="prose prose-sm max-w-none"
    style={{
      fontFamily: "'Times New Roman', serif",
      fontSize: "13px",
      lineHeight: "1.8",
      color: "#1a1a1a",
      // CSS columns: cada columna = una página
      columnWidth: `${PAGE_WIDTH - PAGE_PADDING_X * 2}px`,
      columnGap: "0px",
      columnFill: "auto",
      height: `${CONTENT_HEIGHT}px`,
      // Navegar horizontalmente entre páginas
      transform: `translateX(-${currentPage * (PAGE_WIDTH - PAGE_PADDING_X * 2)}px)`,
    }}
    dangerouslySetInnerHTML={{ __html: html }}
    onClick={handleContentClick}
    onMouseUp={handleMouseUp}
  />
</div>
```

El browser distribuye el texto en columnas de `CONTENT_HEIGHT` de alto. Cada columna tiene exactamente el ancho del área de contenido. Nunca corta una línea a la mitad — si no cabe, la empuja a la siguiente columna.

**2. Medición de páginas (líneas 750-761):**

Cambiar el cálculo de `pageCount`. Con columns, el `scrollWidth` del contenedor indica cuántas columnas se generaron:

```typescript
useEffect(() => {
  if (!html || !contentRef.current) return;
  const frame = requestAnimationFrame(() => {
    if (contentRef.current) {
      const contentWidth = PAGE_WIDTH - PAGE_PADDING_X * 2; // 468px
      const totalWidth = contentRef.current.scrollWidth;
      const newPageCount = Math.max(1, Math.round(totalWidth / contentWidth));
      setPageCount(newPageCount);
      setCurrentPage((prev) => Math.min(prev, newPageCount - 1));
    }
  });
  return () => cancelAnimationFrame(frame);
}, [html]);
```

**3. Medición oculta (líneas 1072-1090):**

Actualizar `measureRef` para usar el mismo layout de columns, así la medición es consistente. O eliminar el `measureRef` por completo ya que ahora medimos con `scrollWidth` directamente del `contentRef`.

**4. Scroll a ocurrencia (líneas 798-804):**

Cambiar el cálculo de página de una ocurrencia. Con columns, la posición horizontal del elemento indica la página:

```typescript
const parentEl = targetNode.parentElement;
const rect = parentEl.getBoundingClientRect();
const containerRect = container.getBoundingClientRect();
const contentWidth = PAGE_WIDTH - PAGE_PADDING_X * 2;
// Con columns, la posición X relativa indica la columna/página
const relativeLeft = rect.left - containerRect.left + (currentPage * contentWidth);
const targetPage = Math.floor(relativeLeft / contentWidth);
setCurrentPage(Math.max(0, Math.min(pageCount - 1, targetPage)));
```

**5. CSS adicional para evitar cortes dentro de párrafos:**

Añadir en el estilo del contenedor de columns:

```css
break-inside: avoid; /* en los hijos directos (p, div, table) */
```

Esto se puede aplicar con una clase CSS global o inline. Añadir en `index.css`:

```css
.docx-columns-page > p,
.docx-columns-page > div,
.docx-columns-page > table {
  break-inside: avoid;
}
```

### Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | translateY → CSS columns + translateX, medición con scrollWidth |
| `src/index.css` | Regla `break-inside: avoid` para párrafos |

2 archivos. Sin migraciones. Sin dependencias nuevas. El resultado es idéntico a Word: el texto nunca se corta a mitad de línea.

