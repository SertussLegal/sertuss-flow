

## Fix: Permitir PDF en "Cargar Cédula"

### Problema
En `PersonaForm.tsx`, el input de archivo solo acepta imágenes (`accept="image/*"`), mientras que `ActosForm.tsx` ya acepta ambos formatos (`image/*,application/pdf`).

### Cambio
**`src/components/tramites/PersonaForm.tsx`** — Línea ~161: cambiar `accept="image/*"` a `accept="image/*,application/pdf"`.

Una línea, un archivo.

