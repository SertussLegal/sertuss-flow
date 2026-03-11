

## Plan: Cálculo de progreso granular por campos

### Enfoque

En lugar de solo verificar "¿existe al menos 1 persona?", contar los **campos individuales llenos** dentro de cada categoría. Para evitar queries pesadas en el Dashboard, el progreso se calcula en `Validacion.tsx` durante cada auto-save y se almacena en `tramites.metadata.progress`.

### Campos clave por categoría

| Categoría | Campos obligatorios | Total |
|-----------|-------------------|-------|
| Personas | nombre_completo, numero_cedula, estado_civil, direccion, municipio_domicilio | 5 por persona |
| Inmueble | matricula_inmobiliaria, identificador_predial, departamento, municipio, direccion, area, linderos, avaluo_catastral | 8 |
| Actos | tipo_acto, valor_compraventa | 2 (+ 3 condicionales si es hipoteca) |

### Lógica

```
totalFields = (5 × numPersonas) + 8 + actosFields
filledFields = count of non-empty string fields
progress = Math.round((filledFields / totalFields) * 100)
```

Se guarda en metadata: `{ progress: 42 }`

### Cambios

| Archivo | Cambio |
|---------|--------|
| `src/pages/Validacion.tsx` | Agregar función `calculateProgress()` que evalúa campos llenos. Guardar resultado en `metadata.progress` durante cada auto-save. |
| `src/pages/Dashboard.tsx` | `getDraftProgress` lee `t.metadata?.progress ?? 0` directamente en vez de calcular con conteos. Eliminar lógica actual de cálculo. |

Cambio pequeño: ~20 líneas en Validacion, ~5 líneas en Dashboard.

