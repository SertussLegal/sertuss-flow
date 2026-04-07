

## Plan: Panel "Documentos Cargados" — Implementación Completa

### Paso 1: `src/components/tramites/ExpedienteSidebar.tsx`
- Quitar `border-r` de la clase del contenedor raíz (línea 43)
- El componente se reutiliza sin cambios funcionales dentro del nuevo Sheet

### Paso 2: `src/components/tramites/InmuebleForm.tsx`
- Eliminar los 3 bloques de badges ("Certificado procesado", "Predial procesado", "Escritura procesada") y botones "Cargar X" (líneas ~396-412)
- Eliminar refs sin uso (`certInputRef`, `predialInputRef`, `escrituraInputRef`) y `renderUploadButton`
- Header queda limpio: solo `<h3>Inmueble</h3>`

### Paso 3: `src/components/tramites/PersonaForm.tsx`
- Eliminar `<input type="file">` + botón "Cargar Cédula" por persona (líneas ~238-261)
- Eliminar refs y handlers sin uso (`fileInputRefs`, `handleScanCedula`, `scanningIndex`)
- Actualizar banner informativo:
  - **Copy final:** `"Sin cédula. Súbela en 📄 Documentos Cargados o completa manualmente."`

### Paso 4: `src/pages/Validacion.tsx`
- Añadir imports: `Sheet, SheetContent, SheetHeader, SheetTitle` + `FileText` de lucide
- Añadir estado: `const [showDocPanel, setShowDocPanel] = useState(false)`
- Calcular contador: `const procesadosCount = expedienteDocs.filter(d => d.status === "procesado").length`
- **Header**: insertar botón antes de "Guardar":
```tsx
<Button variant="ghost-dark" size="sm" onClick={() => setShowDocPanel(true)}
  className="border border-white/30">
  <FileText className="mr-1 h-4 w-4" />
  Documentos ({procesadosCount}/{expedienteDocs.length})
</Button>
```
- **Eliminar** el `div.w-56` con `ExpedienteSidebar` fijo (líneas ~1651-1655)
- **Añadir Sheet** después del header:
```tsx
<Sheet open={showDocPanel} onOpenChange={setShowDocPanel}>
  <SheetContent side="right" className="w-[400px] sm:w-[400px] p-0">
    <SheetHeader className="p-4 border-b">
      <SheetTitle>Documentos Cargados</SheetTitle>
    </SheetHeader>
    <ExpedienteSidebar
      documentos={expedienteDocs}
      onUploadDocument={handleSidebarUpload}
      uploading={sidebarUploading}
    />
  </SheetContent>
</Sheet>
```
- `ResizablePanelGroup` recupera los 224px del sidebar fijo

### Paso 5: `src/components/tramites/DocumentUploadStep.tsx`
- Envolver líneas 576-617 (bloque de notaría) en `{notariasList.length > 0 && (...)}`
- Si no hay notarías configuradas, el bloque completo desaparece

### Verificación de seguridad

| Riesgo | Estado |
|---|---|
| OCR deja de funcionar | No — `scan-document` es independiente del sidebar |
| `handleSidebarUpload` pierde referencia | No — sigue en Validacion.tsx, se pasa al Sheet |
| Auto-guardado se rompe | No — debounce no depende del sidebar |
| Slots opcionales del Paso 1 se pierden | No — `expedienteDocs` los carga en `loadTramite` |
| Notaría selector aparece sin config | No — Paso 5 lo oculta |

### Resumen

| Paso | Archivo | Cambio |
|---|---|---|
| 1 | `ExpedienteSidebar.tsx` | Quitar `border-r` |
| 2 | `InmuebleForm.tsx` | Eliminar badges + botones + refs de carga |
| 3 | `PersonaForm.tsx` | Eliminar "Cargar Cédula", copy conciso en banner |
| 4 | `Validacion.tsx` | Sidebar fijo → botón header + Sheet derecho |
| 5 | `DocumentUploadStep.tsx` | Ocultar bloque notaría si no hay configuradas |

5 archivos. Sin migraciones DB. Sin componentes nuevos.

