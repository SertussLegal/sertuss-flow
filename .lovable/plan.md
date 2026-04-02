

## Auditoría Senior — Plan v2.0: Corrección integral de orquestación OCR

### Diagnóstico crítico del plan original

Audité el código actual contra las 5 fases propuestas. Hallé **4 puntos débiles** que el plan original no resuelve y **2 edge cases** que generarían regresiones:

#### Punto débil 1: Race condition en metadata merge (Fase 3)
El `handleAutoSave()` actual (línea 340-386) hace `delete` + `insert` de inmuebles/personas/actos en cada guardado. Si el autosave (debounce 15s) dispara mientras un OCR scan está guardando metadata en `DocumentUploadStep`, se pierde. El plan dice "hacer merge" pero no aborda que hay dos escritores concurrentes:
- `handleAutoSave` → escribe `metadata` desde estado local
- `DocumentUploadStep` → escribe `metadata.extracted_*` desde el flujo de carga

**Solución v2.0**: Usar `read-then-merge` atómico. Antes de escribir metadata en `handleAutoSave`, leer la metadata actual de DB y hacer spread preservando claves `extracted_*`.

#### Punto débil 2: `handleDocumentoExtracted` es un callback vacío
Línea 455-459: solo hace `console.log`. El plan original dice "hacer `setExtractedDocumento`" pero no aborda que este callback se ejecuta **dentro de InmuebleForm**, no en DocumentUploadStep. Los datos del certificado de tradición se extraen en InmuebleForm, no en el flujo de carga inicial.

**Solución v2.0**: Implementar inmediatamente en `handleDocumentoExtracted`:
```typescript
const handleDocumentoExtracted = useCallback((documento: ExtractedDocumento) => {
  setExtractedDocumento(documento);
  // Persist to metadata immediately (non-destructive merge)
  if (tramiteIdRef.current) {
    supabase.from("tramites").select("metadata").eq("id", tramiteIdRef.current).single()
      .then(({ data }) => {
        const merged = { ...(data?.metadata || {}), extracted_documento: documento };
        supabase.from("tramites").update({ metadata: merged }).eq("id", tramiteIdRef.current!);
      });
  }
}, []);
```

#### Punto débil 3: `inmuebleToRow` hardcodea campos vacíos
Línea 1136: `estrato: ""` y línea 1141: `valorizacion: ""` destruyen datos OCR. La tabla `inmuebles` tiene columnas `estrato` y `valorizacion`. El plan dice corregirlo pero el tipo `Inmueble` en `types.ts` **no tiene** `estrato` ni `valorizacion` ni `nupre`, así que `i.estrato` sería `undefined` sin cambios al tipo.

**Solución v2.0**: Agregar los 3 campos al tipo Y al `createEmptyInmueble()`:
```typescript
// types.ts - Inmueble
estrato?: string;
valorizacion?: string;
nupre?: string;
```

#### Punto débil 4: El predial OCR no emite datos al estado en vivo
En `InmuebleForm.tsx` línea 190-209, cuando se procesa un predial, los datos se aplican al formulario pero **nunca se emiten como `extractedPredial`** al padre. No existe un callback `onPredialExtracted`. Los campos `numero_recibo`, `anio_gravable`, `valor_pagado` del predial se pierden porque `applyOcrResults` solo actualiza el inmueble, no el estado de predial.

**Solución v2.0**: Agregar prop `onPredialExtracted` a InmuebleForm y emitir los datos del predial.

### Edge cases identificados

1. **Inmueble fuera de Bogotá con formato alfanumérico**: Algunos municipios menores asignan códigos prediales que no son puramente numéricos. La heurística `startsWith("AAA")` es correcta porque solo CHIP de Bogotá usa ese prefijo. Pero si el plan usa "si es alfanumérico → es CHIP", eso es incorrecto. **Regla correcta**: solo es CHIP si empieza con `AAA`.

2. **Fecha del documento en formato `DD-MM-AAAA` vs `YYYY-MM-DD`**: El OCR devuelve `DD-MM-AAAA` pero `new Date()` en las líneas 528-532 de DocxPreview interpreta eso como inválido. Si la fecha es `15-03-2020`, `new Date("15-03-2020")` retorna `Invalid Date`.

### Plan v2.0 — Cambios consolidados

**Migración DB**
```sql
ALTER TABLE inmuebles ADD COLUMN IF NOT EXISTS nupre text DEFAULT '';
```

**Archivo 1: `src/lib/types.ts`**
- Agregar `nupre?: string`, `estrato?: string`, `valorizacion?: string` a `Inmueble`
- Agregar esos 3 campos a `createEmptyInmueble()`

**Archivo 2: `supabase/functions/scan-document/index.ts`**
- En `toolsByCertificado.inmueble`: agregar campo `cedula_catastral` con descripción: "Cédula catastral numérica del predio (~20-30 dígitos). NO es el CHIP/NUPRE."
- En `toolsByPredial`: separar `identificador_predial` en dos campos: `chip_nupre` (alfanumérico AAA...) y `cedula_catastral` (numérico largo)
- En prompts base: agregar contexto legal: "CHIP (AAA + alfanumérico) es exclusivo de Bogotá. La cédula catastral es numérica (~20-30 dígitos)."

**Archivo 3: `src/components/tramites/InmuebleForm.tsx`**
- Agregar prop `onPredialExtracted?: (data: { numero_recibo?: string; anio_gravable?: string; valor_pagado?: string; estrato?: string }) => void`
- Líneas 149-154: eliminar `nupreMapping` que sobrescribe `identificador_predial` con NUPRE. En su lugar:
  - NUPRE → `inmueble.nupre`
  - Si el OCR devuelve `cedula_catastral` → `inmueble.identificador_predial`
- Líneas 190-209 (predial): emitir `onPredialExtracted` con `numero_recibo`, `anio_gravable`, `valor_pagado`, `estrato`. Separar: si `identificador_predial` empieza con `AAA` → va a `nupre`; si es numérico largo → va a `identificador_predial`

**Archivo 4: `src/pages/Validacion.tsx`**
- `handleDocumentoExtracted` (línea 455): cambiar de `console.log` a `setExtractedDocumento(documento)` + merge no destructivo en DB
- Agregar `handlePredialExtracted` que haga `setExtractedPredial(data)` + merge en metadata
- `handleAutoSave` (línea 340): antes de escribir metadata, leer metadata actual de DB y hacer merge preservando `extracted_*`
- `inmuebleToRow` (línea 1127): cambiar `estrato: ""` → `estrato: i.estrato || ""`, `valorizacion: ""` → `valorizacion: i.valorizacion || ""`, agregar `nupre: i.nupre || ""`
- Pasar `onPredialExtracted` a InmuebleForm

**Archivo 5: `src/components/tramites/DocxPreview.tsx`**
- Línea 437: `inmueble.cedula_catastral` → usar `identificador_predial` (cédula catastral real)
- Líneas 455-456: `nupre` / `inmueble.nupre` → usar `inmueble.nupre` (campo separado, no cast)
- Líneas 528-532: parsear fecha `DD-MM-AAAA` correctamente en vez de depender de `new Date()`:
```typescript
const parseFechaDoc = (f?: string) => {
  if (!f) return {};
  const m = f.match(/(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})/);
  if (!m) return {};
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return { dia: m[1], mes: meses[parseInt(m[2],10)-1], anio: m[3] };
};
```
- Banner de notaría: ya corregido en implementación anterior, verificar que funcione con los nuevos datos

### Mejores prácticas para prevenir recurrencia

1. **Contrato de tipos estricto**: Cada campo OCR debe tener un tipo TypeScript en `Inmueble`. Si no existe en el tipo, no puede llegar al preview. Eliminar `(inmueble as any)`.
2. **Single source of truth para metadata**: Crear helper `mergeMetadata(existing, partial)` usado tanto por autosave como por DocumentUploadStep.
3. **Validación de mapeo en tests**: Crear un test que compare los placeholders de la plantilla DOCX contra las keys del `buildReplacements()` para detectar gaps automáticamente.
4. **Separación semántica de campos**: Nunca reutilizar un campo para dos significados legales distintos.

### Resumen de archivos

| Archivo | Cambio |
|---|---|
| `src/lib/types.ts` | +3 campos a Inmueble |
| `supabase/functions/scan-document/index.ts` | Separar CHIP/cédula catastral en schemas OCR |
| `src/components/tramites/InmuebleForm.tsx` | +prop onPredialExtracted, separar NUPRE de identificador_predial |
| `src/pages/Validacion.tsx` | handleDocumentoExtracted actualiza estado, autosave con merge, inmuebleToRow corregido |
| `src/components/tramites/DocxPreview.tsx` | Parseo fecha robusto, placeholders separados CHIP vs cédula |

5 archivos + 1 migración DB.

