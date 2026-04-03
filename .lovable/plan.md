

## Auditoría Senior — Plan Definitivo de Corrección del Pipeline OCR → UI

### Hallazgos Críticos (6 problemas de raíz)

**Problema 1: `handleDocumentoExtracted` captura estado stale (CRÍTICO)**
En `Validacion.tsx` línea 682, el `useCallback` depende de `[vendedores, compradores]`. La reconciliación en línea 667 usa los valores del cierre, pero estos pueden estar desactualizados si el usuario cargó otros documentos antes. Además, la reconciliación aquí solo pasa arrays vacíos para `cedulasDetail`, ignorando las cédulas ya escaneadas.

**Problema 2: `personaToRow` no persiste `lugar_expedicion` (CRÍTICO)**
La tabla `personas` en la DB NO tiene columna `lugar_expedicion`. El tipo `Persona` sí la declara como opcional, pero `personaToRow` (línea 1439) no la incluye. El dato se pierde en cada auto-save. Necesita migración DB.

**Problema 3: `handleAutoSave` hace delete-then-insert, borrando datos enriquecidos (CRÍTICO)**
En líneas 556-568, el auto-save BORRA todas las personas e inmuebles y las re-inserta desde el estado React. Si la reconciliación no logró enriquecer el estado (por timing), los datos del OCR se pierden de la tabla relacional. El dato solo sobrevive en `metadata`.

**Problema 4: Merge de metadata en `handleAutoSave` no preserva `extracted_escritura_comparecientes` correctamente**
La línea 541 lista las claves preservadas, pero el save también puede ejecutarse mientras la metadata aún no tiene todos los datos extraídos, causando pérdida parcial.

**Problema 5: Estilos inconsistentes en preview — causa estructural**
En `DocxPreview.tsx`, el post-procesador de `___________` (línea 286-289) se ejecuta DESPUÉS de `expandPersonLoop` pero ANTES de `buildReplacements`. Esto significa que los `___________` dentro de strings compuestas como `comparecientes_vendedor` (línea 462) se envuelven en un span verde "resolved" que contiene texto con `___________` plano adentro, y el regex de línea 287 no los detecta porque están dentro de un `<span>`.

**Problema 6: Falta `data-field-input` en formularios**
Los inputs de `PersonaForm.tsx` e `InmuebleForm.tsx` no tienen el atributo `data-field-input`, haciendo que `onScrollToField` (línea 484) nunca encuentre el elemento destino.

### Plan de Corrección — 7 archivos + 1 migración

**Migración DB: Agregar `lugar_expedicion` a `personas`**
```sql
ALTER TABLE public.personas ADD COLUMN IF NOT EXISTS lugar_expedicion text;
```

**Archivo 1: `src/pages/Validacion.tsx`**

1. **Corregir `personaToRow`** — agregar `lugar_expedicion: p.lugar_expedicion || ""`.

2. **Corregir `handleDocumentoExtracted`** — usar refs funcionales para vendedores/compradores en la reconciliación, no valores del cierre:
   ```typescript
   // Usar setVendedores con callback para acceder al estado más reciente
   setVendedores(prev => {
     const recon = reconcilePersonas(prev, cedulasDetail, comparecientes, dirtyFields);
     return recon.updated;
   });
   ```
   Eliminar la dependencia de `[vendedores, compradores]` del useCallback.

3. **Corregir `handleAutoSave`** — antes de re-insertar personas, enriquecer desde metadata si los campos están vacíos (misma lógica de merge de `loadTramite`). Alternativa más robusta: cambiar delete+insert a upsert con merge.

4. **Agregar rehidratación inmediata post-extracción** — después de que `InmuebleForm` emite datos del OCR, ejecutar la misma lógica de merge que `loadTramite` sobre el estado actual, sin esperar recarga.

**Archivo 2: `src/components/tramites/DocxPreview.tsx`**

1. **Mover el post-procesamiento de `___________`** al final, DESPUÉS de `buildReplacements`. El orden correcto es:
   - `processLoops` (expande vendedores/compradores con `___________` planos)
   - `buildReplacements` (reemplaza `{campo}` con valores o spans rojos)
   - Post-procesar: buscar TODOS los `___________` que NO estén ya dentro de un span y envolverlos con estilo rojo uniforme

2. **Corregir el regex** para que detecte `___________` dentro de spans verdes compuestos (como `comparecientes_vendedor`). Separar la lógica: si un valor "resuelto" contiene `___________`, dividirlo en partes resueltas vs pendientes.

3. **Aplicar formateo legal consistente** — `formatMonedaLegal` a todos los valores monetarios, `formatCedulaLegal` a todas las cédulas.

**Archivo 3: `src/components/tramites/PersonaForm.tsx`**

1. Agregar `data-field-input="nombre_completo"`, `data-field-input="estado_civil"`, etc. a cada input relevante.

2. Incluir el índice de persona en el atributo para soportar múltiples vendedores: `data-field-input="vendedor_0_estado_civil"`.

**Archivo 4: `src/components/tramites/InmuebleForm.tsx`**

1. Agregar `data-field-input="matricula_inmobiliaria"`, `data-field-input="identificador_predial"`, etc. a cada input.

**Archivo 5: `src/components/tramites/ActosForm.tsx`**

1. Agregar `data-field-input` a inputs de actos (tipo_acto, valor_compraventa, entidad_bancaria, etc.).

**Archivo 6: `src/lib/reconcileData.ts`**

1. Sin cambios funcionales. La lógica de merge por `normalizeCC` y protección `isDirty` es correcta.
2. Agregar soporte para enriquecer `lugar_expedicion` desde cédulas escaneadas (ya existe parcialmente).

**Archivo 7: `src/pages/Validacion.tsx` — `onScrollToField` mejorado**

1. Mapear alias de preview a `data-field-input` real (ej: `inmueble.matricula` → `matricula_inmobiliaria`).
2. Si el campo está en un tab diferente, cambiar tab primero, esperar render con `requestAnimationFrame`, luego scroll.
3. Ya existe esta lógica parcialmente (líneas 467-493), pero falta el mapeo de alias.

### Orden de ejecución

1. Migración DB (`lugar_expedicion`)
2. `personaToRow` + `inmuebleToRow` completar campos faltantes
3. `handleDocumentoExtracted` sin stale state
4. `DocxPreview.tsx` — fix de estilos unificados
5. `data-field-input` en los 3 formularios
6. `onScrollToField` con mapeo de alias
7. QA: cargar certificado + predial + escritura + cédula → verificar que todos los campos aparezcan en formulario y preview sin recargar

### Criterio de éxito

- Matrícula, cédula catastral, NUPRE, municipio, ORIP, estado civil, dirección, coeficiente: todos visibles en formulario Y preview tras carga de documentos
- Un solo estilo visual (rojo suave) para todos los campos vacíos
- Click en campo rojo de preview navega al input correcto
- Recargar página no pierde datos (lugar_expedicion ahora persiste en DB)
- Auto-save no destruye datos enriquecidos por reconciliación

### Resumen de archivos

| Archivo | Cambio |
|---|---|
| Migración DB | `ALTER TABLE personas ADD COLUMN lugar_expedicion text` |
| `src/pages/Validacion.tsx` | `personaToRow` + `handleDocumentoExtracted` sin stale + `onScrollToField` alias |
| `src/components/tramites/DocxPreview.tsx` | Post-procesamiento de `___________` al final, regex corregido |
| `src/components/tramites/PersonaForm.tsx` | `data-field-input` en todos los inputs |
| `src/components/tramites/InmuebleForm.tsx` | `data-field-input` en todos los inputs |
| `src/components/tramites/ActosForm.tsx` | `data-field-input` en todos los inputs |
| `src/lib/reconcileData.ts` | Sin cambios (ya correcto) |

6 archivos + 1 migración DB.

