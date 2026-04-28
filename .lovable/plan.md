# Plan aprobado — Ejecución en Build

Ya hay un plan detallado en `.lovable/plan.md`. Confirmo el orden de ejecución y los refinamientos solicitados (Loading/Error en PdfViewerPane, validación del trigger de revocación antes del frontend).

## Orden de ejecución atómico

### Fase 1 — Migración SQL única (bloquea todo lo demás)

Una sola migración idempotente que aplica:

1. **Storage privado**
   - `INSERT INTO storage.buckets (id, name, public) VALUES ('expediente-files', 'expediente-files', false) ON CONFLICT DO NOTHING`
   - Función `public.tramite_org_from_path(path text)` SECURITY DEFINER → resuelve `organization_id` desde el primer segmento del path (`{tramite_id}/...`)
   - 4 policies RLS sobre `storage.objects` filtradas por `bucket_id = 'expediente-files'`:
     - SELECT/INSERT/UPDATE: `tramite_org_from_path(name) = get_active_org(auth.uid())`
     - DELETE: además requiere rol owner/admin

2. **Auditoría obligatoria**
   - Trigger `BEFORE INSERT` en `credit_consumption`: rechaza `tramite_id IS NULL` cuando `action <> 'LEGACY'`

3. **Revocación instantánea**
   - Policy DELETE en `memberships`: owners/admins eliminan miembros de su org activa, excepto su propia membership y memberships personales
   - Trigger `AFTER DELETE ON memberships` SECURITY DEFINER: si la membership coincidía con `user_active_context.organization_id` del usuario afectado, redirige el contexto a su org personal y sincroniza `profiles.organization_id` legacy

4. **Persistencia del .docx**
   - `ALTER TABLE tramites ADD COLUMN IF NOT EXISTS docx_path text`

### Fase 2 — Verificación pre-frontend (read-only)

Antes de tocar UI, ejecuto checks de smoke con `supabase--read_query`:

- `SELECT id, public FROM storage.buckets WHERE id='expediente-files'` → confirma bucket privado
- `SELECT polname FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname LIKE '%expediente%'` → 4 policies
- `SELECT tgname FROM pg_trigger WHERE tgrelid='public.credit_consumption'::regclass` → trigger presente
- `SELECT tgname FROM pg_trigger WHERE tgrelid='public.memberships'::regclass` → trigger presente
- Run `supabase--linter` → cero `errors` críticos nuevos

**Test funcional del trigger de revocación** (sin tocar usuarios reales):
- Verifico la lógica leyendo la función creada y ejecutando un dry-run mental contra un escenario sintético; si hay riesgo, sembrar un caso temporal con `INSERT` en una org de prueba, ejecutar `DELETE FROM memberships WHERE ...` y leer `user_active_context` con `read_query` para confirmar el redirect. Limpieza inmediata.

Si cualquier check falla → **stop, reporto al usuario, no toco frontend.**

### Fase 3 — Backend edge functions

- `supabase/functions/_shared/aiFetch.ts` (nuevo) — `fetchWithRetry` que siempre devuelve `Response` o lanza
- Refactor de `scan-document`, `process-expediente`, `generate-document` para usar el helper. Elimina TS18047 por construcción.

### Fase 4 — Frontend (cliente)

1. `src/lib/expedienteStorage.ts` — `uploadExpedienteFile` + `getExpedienteFileUrl` (signed URL 1h)
2. `src/components/tramites/PdfViewerPane.tsx` — visor con **3 estados explícitos**:
   - **Loading**: skeleton centrado + spinner mientras se firma la URL
   - **Empty**: ícono `FileText` + "Sube documentos en el panel de expediente para verlos aquí"
   - **Error**: ícono `AlertCircle` + "No se pudo cargar el documento" + botón "Reintentar" + link "Abrir en pestaña nueva" como fallback (cubre bloqueo de PDF in-iframe en algunos navegadores)
   - Caché de signed URLs en `useRef<Map>`, reset al cambiar `activeOrgId`
   - Toolbar: selector de documento, zoom 50–200% (paso 25%), cerrar
3. `src/components/CreditBlockedDialog.tsx` — AlertDialog global montado en `App.tsx`, escucha `window.addEventListener('credits:blocked')`
4. `src/lib/notariaDerivation.ts` — derivación única de número/letras/ordinal
5. Edits en `Validacion.tsx`:
   - `ResizablePanelGroup` horizontal con `PdfViewerPane` (desktop) / `Sheet` (mobile)
   - `handleSidebarUpload`: tras OCR exitoso, subir al bucket y persistir path en `metadata.expediente_files[tipo]`
   - `handleConfirmGenerate`: subir `.docx` final + `UPDATE tramites SET docx_path=...`
   - Banner sticky de re-descarga si `status='word_generado'`
   - Derivación notarial atómica respetando `manualFieldOverrides`
   - Radicado: `min-w-[180px] max-w-[180px] tabular-nums`
6. `Dashboard.tsx`: botón "Descargar" que firma `docx_path` (60s) sin regenerar, sin cobrar créditos
7. `Team.tsx`: leer `?tab=consumo`
8. `DocxPreview.tsx`: clase `.notaria-group` (caja sólida morada continua) + popover agrupado
9. `services/credits.ts`: emitir `window.dispatchEvent(new CustomEvent('credits:blocked'))` en 402/saldo 0
10. `index.css`: estilos `.notaria-group`

### Fase 5 — Tests Vitest

- `src/test/rls-credits.test.ts` — operator A vs admin B, mismo org, cross-org
- `src/test/membership-revocation.test.ts` — delete membership → contexto cae a personal, lecturas a la org Y devuelven 0

## Garantías

- **Atomicidad**: si la migración falla, no se toca código. Si la verificación detecta cualquier anomalía (bucket no privado, trigger ausente, lint crítico), reporto y paro.
- **Trigger de revocación validado** funcionalmente antes de la Fase 4.
- **PdfViewerPane** con Loading / Empty / Error / Retry + fallback "Abrir en pestaña" — sin estados ambiguos.
- **Idempotencia**: toda la migración usa `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS` antes de `CREATE POLICY`.
- **Backward compatible**: `consume_credit` legacy sigue funcionando vía exención `LEGACY`; `docx_path` nullable.
- **Sin componentes basura**: cada archivo nuevo tiene un consumidor explícito; se reusan `ResizablePanelGroup`, `AlertDialog`, `VariableEditPopover`, `legalFormatters`.

Aprueba para que pase a Build y arranque la Fase 1.