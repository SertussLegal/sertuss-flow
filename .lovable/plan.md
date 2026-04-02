

## Plan: Corregir la previsualización — los datos SÍ se llenan pero la plantilla usa loops

### Diagnóstico de los logs

Los logs muestran que **los datos SÍ están siendo capturados correctamente por el OCR**. El array "Filled" tiene 27 valores con datos reales (vendedor, comprador, matrícula, dirección, linderos, etc.).

El problema es un **desajuste entre la estructura de la plantilla Word y la lógica de reemplazo**:

**La plantilla Word usa sintaxis de loops (docxtemplater):**
```text
{#vendedores}{nombre}{cedula}{expedida_en}{estado_civil}{/vendedores}
{#compradores}{nombre}{cedula}{expedida_en}{estado_civil}{/compradores}
```

**El código actual hace reemplazo plano:**
```text
comparecientes_vendedor → "MAYA MONTOYA, mayor de edad..."
```

Lo que pasa:
1. El código reemplaza `{comparecientes_vendedor}` (que NO existe en la plantilla) con datos
2. Los placeholders reales como `{#vendedores}{nombre}{/vendedores}` NO se procesan
3. Línea 279 elimina los marcadores de loop `{#vendedores}`, `{/vendedores}`
4. Los `{nombre}`, `{cedula}` huérfanos se convierten en `___________` por la línea 280

También faltan muchos campos que SÍ existen en la plantilla:
- `{inmueble.nombre_edificio_conjunto}`, `{inmueble.coeficiente_letras}`, `{inmueble.coeficiente_numero}`, `{inmueble.orip_zona}`
- `{rph.*}` (datos de registro de propiedad horizontal)
- `{antecedentes.*}` (datos de tradición anterior)
- `{notario_nombre}`, `{notario_decreto}`, `{escritura_numero}`
- `{actos.fecha_escritura_letras}`, `{actos.pago_inicial_*}`, `{actos.saldo_financiado_*}`
- `{#afectacion_vivienda}...{/}`

### Sobre los errores 406

Los dos errores "Failed to load resource: 406" son llamadas al edge function `validar-con-claude` que fallan — probablemente por falta de API key o configuración. No afectan la previsualización.

### Solución

Reemplazar la lógica de sustitución plana por un **procesador de loops** que:
1. Expanda `{#vendedores}...{/vendedores}` repitiendo el bloque HTML por cada vendedor
2. Expanda `{#compradores}...{/compradores}` por cada comprador
3. Dentro de cada repetición, reemplace `{nombre}`, `{cedula}`, `{domicilio}`, `{expedida_en}`, `{estado_civil}` con los datos de esa persona
4. Maneje condicionales `{#afectacion_vivienda}...{/}` y `{^afectacion_vivienda}...{/}`

Y agregar los campos faltantes al mapa de reemplazos para los campos simples (no-loop).

### Cambios en `src/components/tramites/DocxPreview.tsx`

**1. Agregar función `processLoops`** que:
- Busca patrones `{#vendedores}...{/vendedores}` en el HTML
- Repite el contenido interno por cada vendedor, reemplazando `{nombre}` → `p.nombre_completo`, `{cedula}` → `p.numero_cedula`, `{domicilio}` → `p.municipio_domicilio`, `{expedida_en}` → lugar de expedición, `{estado_civil}` → `p.estado_civil`
- Hace lo mismo para `{#compradores}...{/compradores}`
- Procesa condicionales `{#afectacion_vivienda}` / `{^afectacion_vivienda}`

**2. Ampliar `buildReplacements`** con los campos faltantes:
- `inmueble.nombre_edificio_conjunto` (usar `inmueble.direccion` o campo nuevo)
- `inmueble.coeficiente_letras`, `inmueble.coeficiente_numero`
- `inmueble.orip_zona`
- `rph.*` campos (escritura PH, notaría PH, matrícula matriz)
- `antecedentes.*` campos (modo de adquisición, escritura anterior)
- `notario_nombre`, `notario_decreto`
- `escritura_numero`
- `actos.fecha_escritura_letras`
- `actos.pago_inicial_*`, `actos.saldo_financiado_*`

Para campos que aún no existen en el modelo de datos (como `rph`, `antecedentes`, `notario`), se dejarán como `___________` — el usuario los llenará manualmente.

**3. Modificar el `useEffect` de aplicación** (líneas 260-280):
- Primero ejecutar `processLoops(result, vendedores, compradores, actos)` para expandir los loops
- Luego aplicar los reemplazos simples como ya se hace
- Eliminar la línea 279 que borra ciegamente los marcadores de loop (ya se procesan)

**4. Actualizar `Persona` type** si es necesario: agregar campo `lugar_expedicion` opcional para mapear `{expedida_en}`.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | Agregar `processLoops`, ampliar `buildReplacements`, modificar flujo de aplicación |
| `src/lib/types.ts` | Agregar `lugar_expedicion?: string` a `Persona` |

2 archivos.

