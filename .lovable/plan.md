# Diagnóstico — `DocxDebugModal` (solo lectura)

## 1. Código del componente
Archivo: `src/components/tramites/DocxDebugModal.tsx` (828 líneas). Ya visualizado íntegro en las líneas 1–451 (encabezado, lógica de gating interno, tabs, export). Piezas relevantes al gate de acceso:

```tsx
const { profile } = useAuth();
const isAdvanced = profile?.role === "owner" || profile?.role === "admin";
const canExport = isAdvanced;
```

- El modal, por sí mismo, **no verifica ningún permiso para abrirse**: recibe `open` como prop y se muestra si el padre lo activa.
- Internamente `isAdvanced` sólo decide **qué tabs y stats se muestran**: si `role !== owner|admin`, el usuario ve únicamente la pestaña "Guía" (tags + copiar) sin diff/flat/missing/unused/JSON export.
- `canExport` (Copiar/Descargar JSON) también sólo se muestra a owner/admin.
- El toggle "Diagnóstico visual" y su callback `onDebugVisualChange` sólo aparecen para owner/admin y escriben en `localStorage["sertuss.debugDocx"]`. Al cerrar, notifica al padre para sincronizar el flag global en memoria.

## 2. Cómo se monta en `Validacion.tsx`
Estado (líneas 292–294):
```tsx
const [debugDocxOn, setDebugDocxOn] = useState<boolean>(() => isDebugDocxEnabled());
const [debugModalOpen, setDebugModalOpen] = useState(false);
const [debugAuditPayload, setDebugAuditPayload] = useState<DocxAuditPayload | null>(null);
```

Montaje del modal (líneas 3482–3488): siempre renderizado, controlado por `debugModalOpen`.

**Tres puntos que llaman `setDebugModalOpen(true)`:**

1. **Botón Bug de la barra superior** (líneas 3202–3224) — gate estricto:
   ```tsx
   {profile?.role === "owner" && organization?.debug_tools_enabled && (
     <Tooltip>… onClick={() => { setDebugInitialTab("all"); setDebugModalOpen(true); }} …</Tooltip>
   )}
   ```
   Requiere ambas condiciones: rol `owner` **y** `organization.debug_tools_enabled = true`.

2. **Auto-apertura tras render fallido** (líneas 2259–2264): al fallar `doc.render()`, siempre se abre el modal ("Forzar modal de auditoría aunque debug esté OFF, para diagnóstico inmediato"). **Sin gate por rol ni por `debug_tools_enabled`** — se dispara para cualquier usuario autenticado que genere docx y el render falle.

3. **Auto-apertura tras render exitoso** (líneas 2312–2316):
   ```tsx
   if (_debugOn && _auditPayload && !_renderError) {
     setDebugAuditPayload(_auditPayload);
     setDebugModalOpen(true);
   }
   ```
   Gate: `_debugOn = isDebugDocxEnabled()` (localStorage o `?debug=docx` en URL). **Sin gate por rol ni org**: cualquiera puede activar el flag local desde consola/URL y ver el modal en éxito.

## 3. Respuestas explícitas

- **¿Visible para cualquier usuario autenticado?**
  El **botón Bug de la toolbar** está bien gateado (owner + `debug_tools_enabled`). Pero el modal **se abre automáticamente** en dos escenarios sin ese gate:
  a) Falla de render de docx (para todos, sin importar rol ni org).
  b) Render exitoso si `localStorage["sertuss.debugDocx"]="1"` o URL con `?debug=docx` (autoactivable por cualquiera desde DevTools o link manipulado).
  Dentro del modal, un usuario `member` sólo vería la pestaña "Guía"; owner/admin de una org **sin** `debug_tools_enabled` verían todas las tabs y stats sensibles apenas se dispare la auto-apertura, sin que Sertuss haya autorizado a esa org.

- **¿Depende de `organization.debug_tools_enabled`?**
  Sólo el botón manual de la toolbar. Las dos rutas de auto-apertura **son independientes** de esa columna. `SystemMonitor` sí respeta esa columna, así que hay incoherencia de política entre ambas herramientas de diagnóstico.

- **Si es independiente, ¿por qué?**
  No hay comentario en código que lo justifique. Hipótesis técnica razonable: la auto-apertura en fallo se diseñó como salvavidas de debugging inmediato para que Sertuss/desarrollo pudiera investigar sin que el usuario tuviera que reproducir; la ruta de éxito quedó pegada al mismo flag local (`sertuss.debugDocx`) que gobierna los indicadores visuales inline en el editor. Ambos son restos de una época en que el modal era exclusivamente developer-tool antes de que existiera `debug_tools_enabled` a nivel organización.

## 4. Información expuesta cuando se abre

Payload `DocxAuditPayload` (definido en `src/lib/docxDebug.ts`, líneas 347–412) y renderizado:

- `tramiteId` (UUID del trámite del cliente).
- `template` (nombre del archivo .docx) y `tipoActo`.
- `renderMs`, `timestamp`.
- `counts`: tags, flatKeys, mapped, missing, unused, aliased, ignored, empty, scoped, rescued, crossParagraph.
- `tags`: lista completa de tags `{xxx}` de la plantilla notarial.
- `flat`: **aplanado completo de `structuredData`** que entra al render — es decir, TODAS las claves y valores del expediente notarial que se están inyectando en la escritura:
  - Nombres, apellidos, cédulas (número de documento), estado civil, direcciones, teléfonos, correos de vendedores/compradores/apoderados.
  - Datos del inmueble: matrícula inmobiliaria, CHIP/cédula catastral, dirección, linderos si están mapeados, valor.
  - Cuantías: precio de venta, valor de hipoteca, forma de pago.
  - Datos de banco/apoderado: NIT, poder, escritura de constitución.
  - Cualquier otro campo del acto (poder, hipoteca, cancelación).
- `diff.mapped/empty/missing/unused/scoped/sectionsResolved`: nombres de campos técnicos y qué valores están vacíos/faltantes.
- `rescued`: tags reparados por el normalizador con su hint textual.
- `crossParagraph`: fragmentos de plantilla con tags rotos.
- **Botones "Copiar JSON" y "Descargar JSON"** (owner/admin) exportan todo lo anterior a un archivo `docx-audit_<tramite>_<ts>.json`.
- **`logDocxAuditToConsole`** además vuelca el payload a `console` en toda apertura automática — visible para cualquiera que abra DevTools durante un fallo de render, incluso sin ver el modal.

**Nivel de sensibilidad:** alto. El payload contiene datos personales identificables (cédulas, direcciones, teléfonos), datos patrimoniales (precios, hipotecas) y datos comerciales (NITs bancarios). Bajo Ley 1581 califica como dato sensible que requiere control de acceso auditado.

## 5. ¿Está en producción?

Sí. `Validacion.tsx` es la página que sirve a los clientes reales para redactar y descargar la escritura; es parte del bundle publicado (URL productiva `sertuss-flow.lovable.app`). No hay `import.meta.env.DEV` ni feature flag envolviendo el montaje: el modal está desplegado. Lo único que evita que un cliente cualquiera lo vea hoy en operación normal es:
- El botón Bug requiere owner + `debug_tools_enabled=true` (Sertuss controla el flag desde Admin).
- La auto-apertura por éxito requiere activar manualmente el flag local.
- La auto-apertura por fallo se activa **sin control** cuando un render revienta — pero también es cuando el diagnóstico es más útil.

Además, `logDocxAuditToConsole` vuelca a `console` en cualquier apertura, así que aunque el modal no se muestre visualmente, los datos quedan disponibles en DevTools.

## 6. Recomendación de gate correcto (no implementar aún)

Unificar la política con `SystemMonitor`: **todas** las rutas de apertura del `DocxDebugModal` y su volcado a consola deben requerir simultáneamente `profile?.role === "owner"` **y** `organization?.debug_tools_enabled === true`. Concretamente:

1. **Botón Bug** — ya cumple, dejar igual.
2. **Auto-apertura por fallo de render** (líneas 2259–2264) — envolver en el mismo gate; si el usuario final no es owner con debug activo, no abrir el modal, no llamar `logDocxAuditToConsole`, y presentar un toast neutro ("No pudimos generar el .docx. Contacta soporte") con un `monitored.log` que Sertuss consulta desde `SystemMonitor`.
3. **Auto-apertura por éxito** (líneas 2312–2316) — reemplazar `_debugOn` (localStorage/URL, autoactivable) por el gate compuesto rol+org, o al menos exigir ambas condiciones además de `_debugOn`. Aceptable mantener el flag local sólo para los indicadores visuales inline sin datos personales, pero desacoplado de la apertura del modal.
4. **Toggle interno "Diagnóstico visual"** dentro del modal — está bien restringido por `isAdvanced`, pero como sólo debería llegarse al modal si org tiene `debug_tools_enabled`, queda coherente sin cambios adicionales.
5. **`logDocxAuditToConsole`** — condicionar al mismo gate compuesto para no filtrar el payload a DevTools cuando el usuario no es Sertuss-autorizado.

Alternativa más estricta: si Sertuss quiere que ni siquiera owners de la organización vean el JSON crudo con cédulas, atar el gate a `is_platform_admin()` (correo `info@sertuss.com`) en lugar de a `owner + debug_tools_enabled`; hoy `SystemMonitor` usa el patrón org-flag, así que unificar contra ese patrón mantiene coherencia interna.

Restricción respetada: sólo diagnóstico. Ningún archivo modificado.
