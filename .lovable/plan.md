

## Plan: Corregir error de carga dinámica de módulo `mammoth`

### Diagnóstico

El error `Failed to fetch dynamically imported module: .../assets/index-C2PVO_hb.js` (404) ocurre porque:

1. `DocxPreview.tsx` usa `await import("mammoth")` — Vite lo separa en un chunk con hash
2. Después de un redeploy, el hash del chunk cambia, pero el navegador tiene cacheado el JS principal que referencia el hash viejo
3. El chunk viejo ya no existe → 404 → la plantilla no carga

Esto también afecta al `import("pizzip")` y `import("docxtemplater")` en `Validacion.tsx`.

### Solución

Cambiar de `import()` dinámico a **import estático** para `mammoth`, `pizzip` y `docxtemplater`. Estas librerías se usan siempre en la página de validación, así que no hay beneficio real en cargarlas lazy. Al importarlas estáticamente, Vite las incluye en el bundle principal y elimina el problema de chunks huérfanos.

Adicionalmente, agregar un **retry con recarga** como fallback para cualquier import dinámico futuro que pueda fallar.

### Cambios

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | Cambiar `await import("mammoth")` → `import mammoth from "mammoth"` estático al top del archivo |
| `src/pages/Validacion.tsx` | Cambiar `await import("pizzip")` y `await import("docxtemplater")` → imports estáticos al top del archivo |

2 archivos, 4 líneas cambiadas. Sin cambios de DB.

