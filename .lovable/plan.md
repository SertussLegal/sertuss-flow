## Fase 4 — Visor persistente + bus de créditos (aprobada)

Cierra el ciclo del trámite: el .docx generado se sube a `expediente-files`, queda referenciado en `tramites.docx_path`, se previsualiza en formato hoja Carta y se puede re-descargar sin volver a consumir créditos. Errores 402 disparan modal global.

### 1. Verificación previa del trigger de revocación

Antes de tocar frontend, `read_query` para confirmar que `handle_membership_revocation` está enlazado como AFTER DELETE en `memberships`. Si no lo está, migración corta para crearlo.

### 2. Persistencia del .docx en Storage

En `Validacion.tsx › handleConfirmGenerate`, tras `outZip.generate(...)`:
1. Path canónico: `${tramiteId}/${Date.now()}-${fileName}` (tramiteId como primer segmento — las RLS de Fase 1 lo exigen).
2. `supabase.storage.from('expediente-files').upload(path, blob, { contentType, upsert: false })`.
3. Si falla: toast no bloqueante, continúa la descarga local.
4. Si OK: `update tramites set docx_path = path, status = 'word_generado'` en un solo UPDATE; setear `docxPath` en estado local.
5. Conservar la descarga local actual intacta.

### 3. Componente `PdfViewerPane`

`src/components/tramites/PdfViewerPane.tsx`. Props: `{ tramiteId, docxPath: string | null }`.

**Estados:** `idle` (sin docxPath), `loading`, `ready`, `error` (404 / 403 / red — mensaje diferenciado + botón Reintentar).

**Loader:** `createSignedUrl(docxPath, 300)` → `fetch` → `arrayBuffer` → `mammoth.convertToHtml`. Reusar import estático de mammoth (ver `mem://tech/estabilidad-despliegue-vite`).

**Simulación hoja Carta (requerimiento clave del usuario):**
- Wrapper externo con fondo gris oscuro y `padding` vertical para "marco".
- Hoja interna: `max-width: 21.59cm` (Carta), `min-height: 27.94cm`, `padding: 2.54cm` (1 pulgada), fondo blanco puro, sombra elevada estilo glassmorphism, tipografía serif notarial (`'Times New Roman', Georgia, serif`), `font-size: 12pt`, `line-height: 1.5`, color `#1a1a1a`.
- Centrado con `mx-auto`, scroll vertical en el wrapper externo.
- Estilos encapsulados en `.pdf-viewer-page` para no contaminar el resto.
- Botón "Descargar .docx" flotante arriba a la derecha, reusa la signed URL (no consume créditos).

### 4. Hidratación al abrir trámite

Leer `tramites.docx_path` al cargar y guardar en estado `docxPath`. Pasar a `PdfViewerPane`. Tras subida nueva, actualizar el estado local también.

### 5. Wiring del visor

Cuando `docxPath` existe, mostrar tab "Vista final" junto a la "Editor" actual. Sin `docxPath`, solo se ve el `DocxPreview` actual (sin cambios). No romper UX existente.

### 6. Event bus `credits:blocked`

- `src/lib/creditsBus.ts` → `emitCreditsBlocked({ source })` vía `CustomEvent`.
- `src/components/CreditsBlockedModal.tsx` montado una vez en `App.tsx`. Listener global → abre Dialog: "Sin créditos disponibles" + descripción contextual + botón "Ver planes" → `/equipo`.
- Integración en los 4 puntos que invocan edge functions: `DocumentUploadStep.tsx`, `Validacion.tsx › handleSidebarUpload`, `Validacion.tsx › handleConfirmGenerate`, `InmuebleForm.tsx`. Cuando el error indique 402 (preservado por `aiGatewayErrorResponse` de Fase 3), emitir el evento en lugar del toast genérico. Para 429, mantener `notifyHttpQuotaError` actual.

## Archivos afectados

```text
src/components/tramites/PdfViewerPane.tsx        (nuevo)
src/components/CreditsBlockedModal.tsx           (nuevo)
src/lib/creditsBus.ts                            (nuevo)
src/App.tsx                                      (montar modal global)
src/pages/Validacion.tsx                         (upload Storage, hidratar docxPath, tab nueva, emit credits:blocked)
src/components/tramites/DocumentUploadStep.tsx   (emit credits:blocked en 402)
src/components/tramites/InmuebleForm.tsx         (emit credits:blocked en 402)
supabase/migrations/<timestamp>_*.sql            (solo si el trigger de revocación no estuviera ya activo)
```

## Fuera de alcance

Conversión a PDF real (LibreOffice/Gotenberg en backend), versionado/historial de .docx, cambios en edge functions de Fase 3.

## Validación post-implementación

1. Generar trámite → archivo aparece en `expediente-files/<tramiteId>/...` y `docx_path` referenciado.
2. Recargar página → tab "Vista final" carga desde Storage sin llamar a Gemini.
3. `PdfViewerPane` con `docxPath` inexistente → estado de error amigable + Reintentar.
4. Hoja se visualiza con dimensiones Carta y tipografía serif notarial.
5. Forzar 402 → aparece modal global, no toast.
6. Revocar membresía no-personal del usuario activo → `user_active_context` cae a su org personal.
