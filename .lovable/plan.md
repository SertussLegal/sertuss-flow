

## Plan: Limpiar observaciones menores

Las observaciones menores identificadas en la revisión anterior son:

### 1. Eliminar campos legacy no usados en UI

Los campos `estrato`, `valorizacion` (Inmueble) y `afectacion_vivienda_familiar` (Actos) fueron removidos de la interfaz pero siguen en los tipos, factory functions y mappers. Como la base de datos aún tiene estas columnas (visible en `types.ts` autogenerado), los mantendremos en los `toRow` mappers con valores por defecto, pero los eliminaremos de las interfaces y factories de la app.

**`src/lib/types.ts`**:
- Eliminar `estrato` y `valorizacion` de `Inmueble`
- Eliminar `afectacion_vivienda_familiar` de `Actos`
- Eliminar de `createEmptyInmueble()` y `createEmptyActos()`

**`src/pages/Validacion.tsx`**:
- En `inmuebleToRow`: reemplazar `i.estrato` → `""` y `i.valorizacion` → `""` (hardcoded, la DB espera nullable)
- En `actosToRow`: reemplazar `a.afectacion_vivienda_familiar` → `false`

### 2. Rollback de crédito si el OCR falla

Actualmente se consume el crédito antes del scan. Si falla, se pierde. Se debe agregar una función `restore_credit` en la DB y llamarla en el `catch` de cada scan.

**Migración SQL**: Crear función `restore_credit(org_id uuid)` que incrementa `credit_balance` en 1.

**`InmuebleForm.tsx`**, **`PersonaForm.tsx`**, **`ActosForm.tsx`**: En el bloque `catch` de cada handler de scan, llamar `supabase.rpc("restore_credit", { org_id })` para devolver el crédito.

### Resumen de archivos

| Archivo | Cambio |
|---------|--------|
| `src/lib/types.ts` | Eliminar 3 campos legacy de interfaces y factories |
| `src/pages/Validacion.tsx` | Hardcodear valores default en mappers para columnas DB |
| Migración SQL | Crear `restore_credit` RPC |
| `InmuebleForm.tsx` | Agregar rollback en catch |
| `PersonaForm.tsx` | Agregar rollback en catch |
| `ActosForm.tsx` | Agregar rollback en catch |

