

## Plan: Logging de correcciones — comparar data_ia vs datos editados

### Contexto
La tabla `logs_extraccion` ya tiene columnas `data_ia` (lo que devolvió la IA) y `data_final` (lo que el usuario corrigió). El edge function `process-expediente` ya inserta `data_ia`. Falta capturar `data_final` al guardar.

### Cambio en `src/pages/Validacion.tsx`

**1. Almacenar snapshot inicial de la IA** cuando se reciben los resultados de `process-expediente` (línea ~531):
- Guardar en un `useRef` llamado `dataIaSnapshot` el objeto completo `result.templateData` que devolvió la IA al momento de generación.

**2. Construir `data_final` al guardar** (en `handleSave`, después de guardar personas/inmueble/actos):
- Construir un objeto con la misma estructura que `data_ia` pero usando los valores actuales del formulario (vendedores, compradores, inmueble, actos).
- Comparar con `dataIaSnapshot`: solo guardar si hay diferencias.

**3. Upsert en `logs_extraccion`**:
- Buscar el registro existente para el `tramite_id`.
- Hacer UPDATE de `data_final` y `updated_at`.

### Estructura de `data_final`
```typescript
{
  vendedores: vendedores.map(v => ({ nombre_completo, numero_cedula, ... })),
  compradores: compradores.map(c => ({ ... })),
  inmueble: { matricula_inmobiliaria, direccion, ... },
  actos: { tipo_acto, valor_compraventa, ... },
  correcciones: [
    { campo: "inmueble.direccion", valor_ia: "CRA 80A", valor_final: "Carrera 80A #17-85" }
  ]
}
```

El array `correcciones` se genera automáticamente comparando campos entre `dataIaSnapshot` y el estado actual.

### Lógica de diff
Una función `buildCorrecciones(dataIa, dataActual)` que:
- Itera campos planos de inmueble y actos
- Itera personas por número de cédula
- Registra solo los campos donde `valor_ia !== valor_final`

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/Validacion.tsx` | Agregar `dataIaSnapshot` ref, función `buildCorrecciones`, upsert `data_final` en `handleSave` |

Un solo archivo.

