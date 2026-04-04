

## Auditoría Crítica del Pipeline OCR → UI → DOCX

### 1. Análisis de Puntos de Falla en el Merge

**Estado actual: CORRECTO con 2 brechas menores.**

`loadTramite` (líneas 264-341) implementa correctamente el merge de 3 capas:
- Layer 1: DB row (mayor prioridad)
- Layer 2: `metadata.extracted_inmueble` con `ocrFieldMap` (llena campos vacíos)
- Layer 3: `metadata.extracted_predial` con `predialMap` (llena campos restantes)

La lógica `if (!current || current === "" || current === false)` es correcta: solo llena vacíos.

**Brecha 1**: El `ocrFieldMap` (líneas 276-303) NO mapea estos campos PH que el OCR sí extrae:
- `nombre_edificio_conjunto` → falta en el map
- `escritura_ph_numero`, `escritura_ph_fecha`, `escritura_ph_notaria`, `escritura_ph_ciudad` → faltan
- `coeficiente_copropiedad` → el map tiene `coeficiente` → `"coeficiente" as any` (cast forzado, funciona pero frágil)

**Brecha 2**: En carga en vivo (paso 2), `handleDocumentoExtracted` (línea 685) actualiza personas y persiste metadata, pero **NO re-mergea el inmueble**. Si el certificado trae matrícula/ORIP/linderos nuevos, el inmueble NO se actualiza hasta recargar la página.

**Corrección necesaria**: 
1. Agregar campos PH faltantes al `ocrFieldMap`
2. En `handleDocumentoExtracted`, si el OCR devolvió datos de inmueble, ejecutar merge sobre el inmueble actual

---

### 2. Validación de la Lógica de Cruce (Cross-Reference)

**Normalización de CC: IMPLEMENTADO CORRECTAMENTE.**

`reconcileData.ts` línea 21: `normalizeCC` elimina puntos, guiones, espacios y apóstrofes con `/[\.\s\-\']/g`. El cruce en `reconcilePersonas` (línea 68) compara estrictamente `normalizeCC(persona.numero_cedula) === normalizeCC(c.numero_identificacion)`. Esto maneja `79681841` vs `79.681.841` correctamente.

**Estado civil desde Escritura: IMPLEMENTADO CORRECTAMENTE.**

`reconcilePersonas` (líneas 91-103) cruza contra `escrituraComparecientes` por CC normalizada y extrae `estado_civil`, `direccion`, `municipio_domicilio`. La Escritura tiene prioridad como fuente de verdad para estos campos (solo llena vacíos).

**Brecha**: La extracción de comparecientes desde la Escritura depende de que `scan-document` devuelva un array `comparecientes` estructurado. Si el OCR no lo extrae (texto libre sin tool calling para comparecientes), este array llega vacío y la reconciliación no tiene datos.

**Verificación necesaria**: Confirmar que `scan-document/index.ts` tiene un tool `extract_escritura` que incluya un campo `comparecientes` con `nombre`, `cedula`, `estado_civil`, `direccion`.

---

### 3. Solución a la Asincronía de React

**Estado actual: CORRECTAMENTE IMPLEMENTADO con patrón de variables locales.**

`loadTramite` (líneas 220-462) usa exactamente el patrón correcto:
```text
let localVendedores, localCompradores, localInmueble, localActos
→ Merge 3 capas sobre variables locales
→ Reconciliación sobre variables locales (líneas 427-453)
→ setState UNA VEZ al final (líneas 456-459)
```

Esto elimina el stale state durante la carga inicial.

**Para carga en vivo** (post-scan en paso 2): `handleDocumentoExtracted` (líneas 700-717) usa `setVendedores(prev => reconcilePersonas(prev, ...))` — correcto, usa functional update para acceder al estado más reciente.

**Sin problemas pendientes en este punto.**

---

### 4. QA de Previsualización — Estilos Consistentes

**Estado actual: CORRECTAMENTE IMPLEMENTADO con 1 brecha residual.**

`DocxPreview.tsx` tiene un pipeline de 4 pasos:
1. `processLoops` expande `{#vendedores}` con datos o `___________`
2. `buildReplacements` reemplaza `{campo}` → span verde (con dato) o span rojo (sin dato)
3. Limpieza de tags no resueltos `{campo}` → span rojo (línea 648)
4. **FINAL PASS** (líneas 661-681): 
   - Split de spans verdes que contienen `___________` internos → parte verde + parte roja
   - Wrap de `___________` bare no envueltos → span rojo

**Esto funciona**: cuando `reconcileData` llena un campo (ej. `estado_civil`), `buildReplacements` genera un span verde porque `p.estado_civil` ya tiene valor. El rojo desaparece automáticamente.

**Brecha residual**: El regex de la línea 679 usa lookbehind negativo `(?<!<span[^>]*)` que puede no funcionar correctamente en todos los browsers (Safari < 16.4 no soporta lookbehind variable-length). Un regex más robusto sería buscar `___________` que no esté dentro de ningún `<span>` mediante split.

---

### Resumen de Correcciones Necesarias

| # | Archivo | Problema | Severidad |
|---|---------|----------|-----------|
| 1 | `Validacion.tsx` | `ocrFieldMap` no incluye campos PH extendidos | Media |
| 2 | `Validacion.tsx` | `handleDocumentoExtracted` no re-mergea inmueble en vivo | Alta |
| 3 | `scan-document/index.ts` | Verificar que extrae comparecientes de escritura con estado_civil | Alta |
| 4 | `DocxPreview.tsx` | Regex lookbehind puede fallar en Safari antiguo | Baja |

### Plan de Corrección (3 archivos)

**Archivo 1: `src/pages/Validacion.tsx`**
- Agregar al `ocrFieldMap`: `nombre_edificio_conjunto`, `escritura_ph_numero`, `escritura_ph_fecha`, `escritura_ph_notaria`, `escritura_ph_ciudad`, `coeficiente_copropiedad`
- Extraer lógica de merge inmueble en función reutilizable `mergeInmuebleFromOcr(current, ocrData, dirtyFields) → Inmueble`
- En `handleDocumentoExtracted`: si la metadata del scan incluye datos de inmueble, llamar `setInmueble(prev => mergeInmuebleFromOcr(prev, newOcrData, dirtyFields))`

**Archivo 2: `src/components/tramites/DocxPreview.tsx`**
- Reemplazar regex lookbehind (línea 679) con un enfoque más compatible: primero verificar que el `___________` no esté ya dentro de un span con un split/join

**Archivo 3: `supabase/functions/scan-document/index.ts`**
- Verificar y expandir el tool de extracción de escritura para incluir `comparecientes[]` con campos `nombre`, `cedula`, `estado_civil`, `direccion`, `municipio_domicilio`

3 archivos. Sin migraciones DB. Las bases del pipeline (hidratación atómica, normalizeCC, isDirty, structuredData para DOCX) están correctamente implementadas.

