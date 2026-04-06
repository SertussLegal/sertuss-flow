

## Auditoría Técnica: Validación de Flujo Reactivo y Opcionalidad — Fase 2

### Estado actual del código

`DocumentUploadStep.tsx` tiene 3 grupos de slots estáticos (vendedores, compradores, propiedades). No hay toggles dinámicos ni slots opcionales. El botón "Continuar" solo requiere `hasAny` (al menos 1 documento procesado). La metadata se construye en `handleContinue` y se persiste en un solo `insert`.

`Validacion.tsx` ya tiene hidratación atómica con `loadTramite`, merge 3 capas, reconciliación con `isDirty`, y re-merge en vivo con `handleDocumentoExtracted`.

### Respuestas a las 4 inconsistencias técnicas

**1. Opcionalidad No-Bloqueante**

Los slots dinámicos (Crédito, Poder) tendrán `isRequired: false`. El botón "Continuar" seguirá usando `hasAny` — no validará slots opcionales vacíos. En metadata se persistirá `toggles: { tieneCredito: true, tieneApoderado: false }` y si el toggle está activo pero sin archivo: `slots_pendientes: ["carta_credito"]`. Esto permite que `DocxPreview` muestre esos campos como "pendiente" (naranja) en vez de "error" (rojo).

**2. Sincronización del Clip (Fase 3 — no se implementa ahora)**

Se documenta la estrategia pero NO se ejecuta hasta confirmar Fase 2. La lógica será: el clip invoca `scan-document` con un parámetro `target_field` que indica qué campo específico se quiere llenar. El resultado se aplica con `setInmueble(prev => ...)` respetando `manuallyEditedFieldsRef` (`isDirty`). Solo el campo objetivo se actualiza si no está dirty.

**3. Persistencia del Sidebar (Fase 3 — no se implementa ahora)**

El sidebar se alimentará de `metadata.documentos_procesados` (array en JSONB). Cada upload actualiza este array con `{ tipo, nombre, status, timestamp }`. No se necesita suscripción realtime — un callback `onDocumentProcessed` actualizará el estado local.

**4. Toggles persistentes inmediatamente**

Los toggles se guardarán en `metadata.toggles` del trámite con un `debounce` de 500ms al cambiar. No esperan al botón "Continuar". En `loadTramite`, se leen estos toggles para restaurar el estado si el usuario recarga.

### Plan de implementación — Solo Fase 2

**Archivo: `src/components/tramites/DocumentUploadStep.tsx`**

Cambios concretos:

1. Agregar estados `tieneCredito` y `tieneApoderado` (boolean, default `false`)
2. Agregar dos `Switch` toggles debajo de la sección "Documentos del Inmueble":
   - "¿El comprador tiene crédito hipotecario?" → despliega slot "Carta de Aprobación de Crédito" (tipo `carta_credito`)
   - "¿Hay apoderado en este trámite?" → despliega slot "Poder Notarial" (tipo `poder_notarial`)
3. Los slots dinámicos usan el mismo `renderSlotCard` existente
4. En `handleContinue`:
   - Agregar `toggles: { tieneCredito, tieneApoderado }` a metadata
   - Si toggle activo pero slot vacío: agregar `slots_pendientes: ["carta_credito"]` a metadata
   - Los slots opcionales vacíos NO bloquean la navegación
5. Persistencia inmediata de toggles: NO aplicable en paso 1 porque el trámite aún no existe (se crea en `handleContinue`). Los toggles se persistirán como parte del `insert` inicial.

**Archivo: `src/pages/Validacion.tsx`**

Cambios:
- En `loadTramite`: leer `metadata.toggles` y `metadata.slots_pendientes`
- Pasar `slotsPendientes` a `DocxPreview` para diferenciar campos "pendiente opcional" (naranja) de "faltante crítico" (rojo)

**Archivo: `src/components/tramites/DocxPreview.tsx`**

Cambios:
- Recibir prop `slotsPendientes?: string[]`
- En el post-procesado de `___________`: si el campo vacío corresponde a un slot pendiente, usar estilo naranja (`background: hsl(38 92% 95%); color: hsl(38 92% 40%)`) en vez de rojo

### Resumen

| Archivo | Cambio |
|---|---|
| `DocumentUploadStep.tsx` | Toggles dinámicos + slots opcionales + metadata con toggles/pendientes |
| `Validacion.tsx` | Leer toggles/pendientes de metadata, pasar a preview |
| `DocxPreview.tsx` | Estilo naranja para campos de slots opcionales pendientes |

3 archivos. Sin migraciones DB. Sin Fase 3 (Sidebar/Clips) — eso se aborda después de confirmar que los toggles funcionan correctamente.

