## Ejecución: Side-by-Side, Derivación Notarial Única, RLS de Storage, Auditoría

Plan listo para ejecutar. Cero código basura: todo se monta sobre archivos y patrones existentes, sin duplicar componentes.

---

### Paso 1 — Migración SQL (una sola, idempotente)

**Storage privado para PDFs del expediente**
- `INSERT INTO storage.buckets ('expediente-files', public=false)`.
- Path convention: `{tramite_id}/{tipo}/{filename}` — el primer segmento es el ancla de seguridad.
- Helper `tramite_org_from_path(path)` SECURITY DEFINER → resuelve `organization_id` del trámite.
- 4 policies sobre `storage.objects` (bucket scoped):
  - SELECT/INSERT/UPDATE: `tramite_org_from_path(name) = get_active_org(auth.uid())`.
  - DELETE: además requiere `get_user_role IN ('owner','admin')`.
- Resultado: solo miembros con la org activa coincidente pueden listar/descargar/subir; nadie de otra org puede ver nada aunque adivine el path.

**Auditoría: tramite_id obligatorio**
- Trigger `BEFORE INSERT` en `credit_consumption`: rechaza `tramite_id IS NULL` excepto cuando `action = 'LEGACY'` (preserva el wrapper `consume_credit` viejo). Garantiza vínculo trámite↔consumo en todos los flujos productivos.

**Revocación instantánea al eliminar membership**
- Policy DELETE sobre `memberships`: owners/admins eliminan miembros de su org activa, **excepto** la suya propia (no auto-degradación) y **excepto** memberships personales.
- Trigger `AFTER DELETE ON memberships` (SECURITY DEFINER): si la membership coincidía con `user_active_context.organization_id` del usuario afectado, mueve el contexto a su org personal (que siempre existe por `handle_new_user`). También reasigna `profiles.organization_id` legacy. Como las RLS filtran por `get_active_org`, el acceso a `credit_consumption`, `tramites` y `activity_logs` de esa org se corta en la siguiente query sin esperar refresh de token.

**Persistencia del .docx**
- `ALTER TABLE tramites ADD COLUMN docx_path text` (nullable). Sirve para que Dashboard ofrezca "Descargar" sin regenerar.

---

### Paso 2 — Helper compartido en edge functions: `supabase/functions/_shared/aiFetch.ts`

Una sola función `fetchWithRetry(url, init, opts?) → Promise<Response>` que **siempre** devuelve `Response` (lanza si la red falló todas las veces), eliminando TS18047 por construcción. Más `aiErrorResponse(status, corsHeaders)` para uniformar 402/429/500.

**Refactor de las 3 funciones:**
- `scan-document/index.ts` (líneas 437-473): reemplazar el loop manual + `if (!response)` por `const response = await fetchWithRetry(...)`. Quita la rama `if (!response)` muerta.
- `process-expediente/index.ts` (línea 150): usar `fetchWithRetry`.
- `generate-document/index.ts` (línea 120): usar `fetchWithRetry`.

**Cliente** (`DocxPreview.tsx:537`): es `fetch("/template_venta_hipoteca.docx")` para asset estático local — ya retorna Response definida. El `if (!response.ok)` actual es correcto. **Sin cambios.**

---

### Paso 3 — Storage helper cliente: `src/lib/expedienteStorage.ts`

Wrapper minimalista (40 líneas) con dos funciones:
- `uploadExpedienteFile(tramiteId, tipo, file): Promise<string>` → `supabase.storage.from('expediente-files').upload(path, file, {upsert:true})` y devuelve el `path`.
- `getExpedienteFileUrl(path, expiresIn=3600): Promise<string>` → `createSignedUrl(path, expiresIn)`.

**Integración en `Validacion.tsx > handleSidebarUpload`** (línea 1199): después del OCR exitoso y antes de `toast`, subir el archivo al bucket y persistir el path en `tramites.metadata.expediente_files[tipo] = path`. Si el upload falla, no rompe el OCR — solo loguea (el side-by-side simplemente mostrará "no disponible").

---

### Paso 4 — Side-by-Side: `src/components/tramites/PdfViewerPane.tsx`

Componente nuevo, único, ~120 líneas:
- Toolbar superior (`h-10`): selector de documento (Select shadcn con tipos disponibles desde `expediente_files`), botones `−`/`+` (zoom 50%–200%, paso 25%, badge `100%`), botón cerrar `X`.
- Cuerpo: `<iframe>` con `src={signedUrl}#toolbar=0&navpanes=0` envuelto en `<div style={{transform: scale(z); transformOrigin:'top left'; width:${100/z}%}}>` para zoom CSS estable, contenedor `overflow:auto`.
- Caché de signed URLs en `useRef<Map>` para no regenerar al cambiar zoom.
- Empty state si `expediente_files` vacío: ícono + "Sube documentos en el panel de expediente para verlos aquí".

**Integración en `Validacion.tsx`**:
- Estado `const [showPdfPane, setShowPdfPane] = useState(false)`.
- Botón en el header (junto a `FolderOpen`) con ícono `PanelRightOpen`/`PanelRightClose` que togglea.
- Envolver el área de tabs central en `<ResizablePanelGroup direction="horizontal">` (ya importado, no usado actualmente). Panel izquierdo `defaultSize={showPdfPane ? 55 : 100}` con los tabs; panel derecho `defaultSize={45}` montado condicionalmente con `<PdfViewerPane>`. Persistir tamaño en `localStorage` con key `validacion:pdfPaneSize`.
- En móvil (`lg:hidden`): el botón abre el visor en un `Sheet` (no resizable).

---

### Paso 5 — Derivación Notarial Única: `src/lib/notariaDerivation.ts`

Función `deriveNotariaTramite(numero: string, formato?: FormatoOrdinal): { numero, numero_letras, ordinal }` que llama internamente a `numeroNotariaToLetras` y `numeroToOrdinalAbbr` (ya en `legalFormatters.ts`). Una única fuente de verdad.

**Integración:**
- En `Validacion.tsx`, en el `onChange` de `notariaTramite.numero_notaria`, llamar `deriveNotariaTramite` y rellenar los 3 campos espejo en una sola operación atómica — **solo si** ninguno está marcado en `manualFieldOverrides` (respeta edición manual).
- En `DocxPreview.tsx > buildReplacements`, mismo principio: si `numero` existe y los espejo no, derivar.

**Clase `.notaria-group` en `src/index.css`**: borde morado **continuo** (no dashed), agrupa visualmente los 3 hijos:
```css
.notaria-group {
  background: #f5f3ff;
  border: 1px solid #6d28d9;
  border-radius: 3px;
  padding: 0 6px;
  display: inline;
}
.notaria-group .var-resolved,
.notaria-group .var-user-edited { border:none; background:transparent; padding:0; }
```
Reemplazar el `style=` inline en `DocxPreview.tsx:865` por `class="notaria-group"`. Visual: una sola caja sólida en vez de tres elementos sueltos.

**Edición agrupada en `VariableEditPopover`**: añadir prop opcional `groupKey?: "notaria-numero"`. Cuando esté presente, el popover pide solo el **número** y al aplicar deriva los 3. En `DocxPreview` se vincula el wrapper `data-group="notaria-numero"` a un único click handler que abre el popover con `groupKey`.

---

### Paso 6 — Modal global de créditos 402: `src/components/CreditBlockedDialog.tsx`

`AlertDialog` con copy "Te quedaste sin créditos para procesar este trámite", botón primario "Ver consumo y recargar" → `navigate('/equipo?tab=consumo')`, secundario "Cerrar".

**Patrón sin prop-drilling**: en `src/services/credits.ts` cuando `consumeCredit` devuelve false o `notifyHttpQuotaError(402)`, en lugar de `toast` disparar:
```ts
window.dispatchEvent(new CustomEvent('credits:blocked'));
```
Montar `<CreditBlockedDialog />` una sola vez dentro de `<AuthProvider>` en `App.tsx`. El componente escucha el evento con `useEffect` y abre el AlertDialog. Funciona para edge functions y RPCs sin acoplar la UI a cada llamador.

`Team.tsx` ya tiene tab `consumo`; añadir lectura de `?tab=consumo` con `useSearchParams` para activar la pestaña al llegar.

---

### Paso 7 — Descarga persistida del .docx

En `Validacion.tsx > handleConfirmGenerate` (línea 2009-2021), después de generar el blob:
1. Subir a storage: `path = tramiteId/_final/Escritura.docx` (mismo bucket, mismas RLS — el primer segmento sigue siendo `tramiteId`).
2. `UPDATE tramites SET status='word_generado', docx_path=path WHERE id=tramiteId`.
3. La descarga inmediata actual (`link.click()`) se mantiene.

**Dashboard.tsx**: en filas con `status='word_generado'` y `docx_path`, botón `Descargar` que pide `createSignedUrl(docx_path, 60)` y dispara click. Sin regenerar, sin cobrar créditos extra.

**Banner de re-entrada en Validacion**: si entras a un trámite con `status='word_generado'`, mostrar banner sticky con CTA "Descargar Word" usando el mismo path.

---

### Paso 8 — Pruebas (Vitest + supabase-js contra Lovable Cloud)

- `src/test/rls-credits.test.ts`: dos usuarios sembrados (operator A, admin B mismo org). Inserta consumos con cada uno. Confirma `select` de A ve solo sus filas; B ve todas. Cross-org devuelve 0.
- `src/test/membership-revocation.test.ts`: crea membership extra a usuario X en org Y, registra consumo, hace `delete from memberships where user_id=X and organization_id=Y`. Verifica que (a) `user_active_context` ya no apunta a Y, (b) `select credit_consumption where organization_id=Y` retorna 0 filas para X.

Las pruebas usan el `service_role` del entorno de test para sembrar y luego `createClient(anon, jwt)` por usuario para validar RLS desde el lado cliente.

---

### Paso 9 — Header: radicado anti-shift y AuthContext

- `Validacion.tsx:2550, 2558`: el `w-[180px]` actual no garantiza ancho fijo si el chip cambia entre input y botón. Añadir `min-w-[180px] max-w-[180px]` al input y `tabular-nums` a ambos para que dígitos no salten 1px.
- `AuthContext.switchContext`: tras `set_active_context` invalidar también el caché de signed URLs del visor (los archivos de la otra org no son accesibles). Implementación: el `PdfViewerPane` resetea su `Map` al cambiar `activeOrgId`.

---

### Resumen de archivos

| Acción | Archivo |
|---|---|
| Nuevo (migración SQL) | una migración aplicada vía supabase migration tool |
| Nuevo | `supabase/functions/_shared/aiFetch.ts` |
| Nuevo | `src/lib/expedienteStorage.ts` |
| Nuevo | `src/lib/notariaDerivation.ts` |
| Nuevo | `src/components/tramites/PdfViewerPane.tsx` |
| Nuevo | `src/components/CreditBlockedDialog.tsx` |
| Nuevo | `src/test/rls-credits.test.ts`, `src/test/membership-revocation.test.ts` |
| Editar | `supabase/functions/scan-document/index.ts` (usar fetchWithRetry, eliminar guard null) |
| Editar | `supabase/functions/process-expediente/index.ts` (idem) |
| Editar | `supabase/functions/generate-document/index.ts` (idem) |
| Editar | `src/pages/Validacion.tsx` (ResizablePanelGroup central, upload a storage, derivación notaría, banner descarga, radicado min/max width, persistir docx_path) |
| Editar | `src/pages/Dashboard.tsx` (botón Descargar) |
| Editar | `src/pages/Team.tsx` (`?tab=consumo`) |
| Editar | `src/components/tramites/DocxPreview.tsx` (clase `notaria-group`, derivación, popover agrupado) |
| Editar | `src/components/tramites/VariableEditPopover.tsx` (prop `groupKey`) |
| Editar | `src/services/credits.ts` (emit `credits:blocked`) |
| Editar | `src/contexts/AuthContext.tsx` (sin cambios estructurales — el reset de URLs vive en `PdfViewerPane`) |
| Editar | `src/App.tsx` (montar `<CreditBlockedDialog/>`) |
| Editar | `src/index.css` (`.notaria-group`) |

### Riesgos y mitigaciones

- **Bucket nuevo**: trámites viejos no tendrán PDFs persistidos → empty state explícito en el visor; el flujo OCR sigue funcionando idéntico.
- **Trigger `tramite_id`**: `LEGACY` exento; `unlock_expediente` (apertura) ya pasa `p_tramite_id` real → no rompe nada existente.
- **Trigger revocación**: SECURITY DEFINER usa la org personal del usuario como fallback (siempre creada por `handle_new_user`). Si por alguna razón no existiera, cae a la membership más antigua.
- **Side-by-side iframe PDF**: navegadores con bloqueo de PDF in-iframe → mostrar fallback "Abrir en pestaña" como último recurso (link a la signed URL).
- **Derivación notarial**: respeta `manualFieldOverrides` — si el usuario editó letras u ordinal a mano, no se sobrescriben aunque el número cambie (consistente con el contrato actual).

### Confirmaciones

- No se duplican componentes: se reusa `ResizablePanelGroup`, `AlertDialog`, `VariableEditPopover`, `legalFormatters`.
- Nada queda colgado: cada archivo nuevo tiene un consumidor explícito en el plan.
- Backward compatible: `consume_credit` legacy, `get_user_org`, RLS existentes intactas.