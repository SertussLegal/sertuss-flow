

## Plan: Indicadores visuales de campos llenados por OCR

### Enfoque

Trackear qué campos fueron llenados por OCR usando un `Set<string>` de nombres de campo en cada formulario. Cuando el OCR llena un campo, se agrega al set. Si el usuario edita manualmente ese campo, se remueve del set. Se muestra un pequeño badge "OCR" junto al label del campo.

### Cambios por archivo

**1. Nuevo componente `src/components/tramites/OcrBadge.tsx`**
- Componente simple: un `<Badge variant="secondary">` con texto "OCR" y un ícono `ScanLine`.
- Se renderiza junto al `<Label>` cuando el campo está en el set de campos OCR.

**2. `src/components/tramites/InmuebleForm.tsx`**
- Agregar estado `ocrFields: Set<string>` con `useState`.
- Tras cada scan exitoso, agregar los campos que fueron actualizados al set (ej: después de certificado → `matricula_inmobiliaria`, `codigo_orip`, etc.).
- En `update()`, remover el campo del set (el usuario lo editó manualmente).
- Renderizar `<OcrBadge>` junto al `<Label>` de cada campo que esté en el set.

**3. `src/components/tramites/PersonaForm.tsx`**
- Agregar estado `ocrFields: Map<number, Set<string>>` (por índice de persona).
- Tras scan de cédula exitoso, agregar campos extraídos al set de esa persona.
- En `updatePersona()`, remover del set.
- Renderizar `<OcrBadge>` junto a labels correspondientes.

**4. `src/components/tramites/ActosForm.tsx`**
- Mismo patrón: `ocrFields: Set<string>` para campos de hipoteca llenados por poder/carta.
- Agregar tras scan, remover en `update()`, renderizar badge.

### Diseño visual

El badge será pequeño, color secundario (gris/azul claro), inline con el label:
```
Matrícula Inmobiliaria [OCR]   _______________
```

Se desvanece si el usuario edita el campo manualmente, indicando que ya no es dato automático.

