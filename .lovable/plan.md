

## Plan: Expediente Sidebar Interactivo — Implementación Completa

### Paso 1: `src/components/tramites/ExpedienteSidebar.tsx` — Reescritura completa

**Nuevas props e imports:**
```typescript
interface ExpedienteSidebarProps {
  documentos: ExpedienteDoc[];
  onUploadDocument?: (tipo: string, file: File) => void;
  onReplaceDocument?: (tipo: string, file: File) => void;
  onDeleteDocument?: (tipo: string) => void;
  onAddCedula?: (file: File) => void;
  onToggleChange?: (toggle: string, value: boolean) => void;
  toggles?: { tieneCredito: boolean; tieneApoderado: boolean };
  uploading?: string | null;
}
```

Imports: `RefreshCw`, `Trash2`, `Plus` de Lucide + `Switch` de ui + `AlertDialog` components + `Separator`.

**Layout en 3 secciones:**

1. **Documentos Obligatorios** — filtrar docs con tipo `certificado_tradicion`, `predial`, `escritura_antecedente`
2. **Cédulas de Identidad** — filtrar docs con tipo que empieza con `cedula_` + botón `[+ Agregar Cédula]`
3. **Documentos Opcionales** — 2 `Switch` toggles controlados por prop `toggles`

**Cada doc procesado** muestra fila de acciones:
- `RefreshCw` (ghost, sm) → file input oculto → `onReplaceDocument(tipo, file)`
- `Trash2` (ghost, sm, text-destructive) → abre AlertDialog → `onDeleteDocument(tipo)`

**AlertDialog** con estado local `deleteTarget: string | null`:
- Título: "¿Eliminar documento?"
- Descripción: "Se borrarán los datos extraídos de este documento en el formulario y el documento final."
- Acciones: "Cancelar" / "Eliminar" (destructive)

**Sección Opcionales:**
- Switch "¿Tiene Crédito Hipotecario?" → `onToggleChange("tieneCredito", value)`
- Switch "¿Tiene Apoderado?" → `onToggleChange("tieneApoderado", value)`
- Al activar, el slot correspondiente ya aparece en `documentos` (gestionado por Validacion.tsx)

**Botón "+ Agregar Cédula":**
- File input oculto → `onAddCedula(file)`
- Estilo: `variant="outline"`, `dashed border`, icono `Plus`

---

### Paso 2: `src/pages/Validacion.tsx` — Estado + Handlers

**2a. Estado de toggles** (~línea 244):
```typescript
const [docToggles, setDocToggles] = useState({ tieneCredito: false, tieneApoderado: false });
```
Inicializar en `loadTramite` desde `meta?.toggles` (ya existe parcialmente en línea 598-601), expandir para setear `docToggles`.

**2b. `handleSidebarDelete(tipo: string)`:**

Limpieza profunda por tipo:
- `certificado_tradicion` → `setInmueble(createEmptyInmueble())`, borrar `extracted_inmueble` de metadata
- `predial` → `setExtractedPredial(null)`, borrar `extracted_predial`
- `escritura_antecedente` → `setExtractedDocumento(null)`, borrar `extracted_documento`, `extracted_escritura_comparecientes`, `extracted_titulo_antecedente`
- `cedula_*` → filtrar persona del array vendedores/compradores por cédula, borrar de `extracted_cedulas_detail`
- `carta_credito` → limpiar campos hipoteca en actos (`valor_hipoteca`, `entidad_bancaria` si vienen de carta), desactivar toggle, borrar `extracted_carta_credito`
- `poder_notarial` → limpiar campos apoderado en actos, desactivar toggle, borrar `extracted_poder_notarial`

Actualizar `expedienteDocs`: cambiar status a `"pendiente"` (o eliminar si es cédula extra).
Persistir metadata limpia en DB con read-then-merge.

**2c. `handleSidebarReplace(tipo: string, file: File)`:**

1. Ejecutar la misma limpieza que `handleSidebarDelete` (el usuario ve campos volver a `___________`)
2. Luego llamar `handleSidebarUpload(tipo, file)` para re-procesar

**2d. `handleToggleChange(toggle: string, value: boolean)`:**

1. `setDocToggles(prev => ({ ...prev, [toggle]: value }))`
2. Si activado: agregar slot pendiente a `expedienteDocs`
3. Si desactivado: eliminar slot + llamar limpieza de datos correspondiente
4. Si `tieneCredito`: sincronizar `setActos(prev => ({ ...prev, es_hipoteca: value }))`
5. Persistir `toggles` en metadata

**2e. `handleSidebarAddCedula(file: File)`:**

1. Consumir crédito
2. Llamar `handleSidebarUpload("cedula", file)` — el scan-document procesa como cédula
3. El handler existente ya agrega la persona via `handlePersonasExtracted`
4. Agregar entrada nueva a `expedienteDocs` con nombre extraído

**2f. Pasar nuevas props al Sheet** (líneas 1846-1850):
```tsx
<ExpedienteSidebar
  documentos={expedienteDocs}
  onUploadDocument={handleSidebarUpload}
  onReplaceDocument={handleSidebarReplace}
  onDeleteDocument={handleSidebarDelete}
  onAddCedula={handleSidebarAddCedula}
  onToggleChange={handleToggleChange}
  toggles={docToggles}
  uploading={sidebarUploading}
/>
```

---

### Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/components/tramites/ExpedienteSidebar.tsx` | 3 secciones, acciones Reemplazar/Eliminar, AlertDialog, toggles, + Agregar Cédula |
| `src/pages/Validacion.tsx` | Estado toggles, handlers replace/delete/toggle/addCedula, pasar props |

2 archivos. Sin migraciones. Sin dependencias nuevas.

