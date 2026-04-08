

## Plan: Limpiar imports no usados en Validacion.tsx

### Validación

`SheetHeader` y `SheetTitle` aparecen **solo** en la línea de import (línea 6). No se usan en ningún lugar del JSX del archivo — fueron eliminados del template cuando se rediseñó el sidebar para que el `ExpedienteSidebar` maneje su propio header.

Eliminarlos no afecta nada. Es limpieza pura de código muerto.

### Cambio

**`src/pages/Validacion.tsx` (línea 6)**:

Antes:
```typescript
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
```

Después:
```typescript
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
```

1 archivo. 1 línea. Riesgo: cero.

