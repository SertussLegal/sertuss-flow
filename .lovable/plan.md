# Fix UX ProsaApoderadoModal — Punto de decisión + orden de cierre

> **Nota de estado:** este plan ya fue aprobado e implementado en el turno anterior. Suite completo verde (23 files / 265 tests, incluyendo 8 nuevos en `ProsaApoderadoModal.test.tsx`). Lo re-emito sin cambios porque el mensaje actual repite el mismo alcance. Si querés modificar algo del diseño ya en árbol, indicalo y ajusto el plan.

## Diagnóstico

**Toaster fuera del Dialog.** `src/App.tsx:36-37` monta `<Toaster />` y `<Sonner />` al nivel de `App`, encima de `<BrowserRouter>` — fuera de cualquier `<DialogContent>`. Un `toast.success` sobrevive al desmontaje del modal: el reorden es seguro.

**Preview reactiva.** `ProsaLiveRenderer` recibe `override` por prop y usa `useMemo([base, override, section])`. Basta pasarle un `displayOverride` distinto al panel izquierdo para reflejar la sugerencia pendiente sin duplicar componentes.

**Edge tolera reintento.** `adaptar-estilo-prosa` acepta `rawText` de hasta 8000 chars. Concatenar el comentario del usuario al final del `rawText` original con un separador cabe en el mismo contrato — sin cambios de edge.

## 1. Punto de decisión explícito para sugerencia IA

### Estado nuevo (`ProsaApoderadoModal.tsx`)

```ts
const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(null);
const [retryComment, setRetryComment] = useState("");
const [lastRawText, setLastRawText] = useState<string | null>(null);
const [showOriginal, setShowOriginal] = useState(false);
```

`lastRawText` permite reintentar concatenando el comentario sin depender de `rescueText` (que se limpia al parquear la sugerencia).

### `handleRescueAsReference` (rediseñado)

Guarda el resultado en `pendingSuggestion` y `lastRawText`. **No toca `notas`.** Limpia `rescueText`. Sin `toast.success` (la banda de decisión ya es señal visual).

### Preview con sugerencia aplicada

```ts
const displayOverride = pendingSuggestion
  ? { ...previewOverride, notas_adicionales: pendingSuggestion }
  : previewOverride;
```

Pasado al panel izquierdo. Badge "Simulando sugerencia IA" en el header del panel.

### UI (columna derecha, reemplaza banda de rescate cuando hay sugerencia)

```text
┌─ Sugerencia de la IA — pendiente de tu decisión ────────────┐
│ [▸ Ver texto original que pegaste]  (colapsable)             │
│ Propuesta IA: <pendingSuggestion, readonly>                  │
│ [ Aplicar ]  [ Descartar ]                                   │
│ ─ Reintentar con un comentario ─                             │
│ [ input ] [Reintentar]                                       │
└──────────────────────────────────────────────────────────────┘
```

Textarea de notas queda `disabled` mientras hay sugerencia pendiente (evita edición ambigua del origen).

### Handlers

- **Aplicar:** `setNotas(pendingSuggestion); setPendingSuggestion(null); ...` + `toast.success("Sugerencia aplicada — revísala antes de guardar")`.
- **Descartar:** limpia `pendingSuggestion`/`retryComment`/`lastRawText`/`showOriginal`. `notas` conserva el texto original pegado (no lo tocamos).
- **Reintentar:** concatena `${lastRawText}\n\n---\nAjuste solicitado por el usuario: ${comment}` truncado a `MAX_RAW_TEXT=8000`. Reinvoca `adaptar-estilo-prosa`. Si `notas_sugeridas` viene vacío (edge sanitizó y rechazó por marcador canónico o token prohibido), `toast.info("La IA propuso algo inválido — intenta con otro comentario")` — la propuesta previa sigue visible y `retryComment` se conserva para editar. **Nunca JSON crudo.**

### Guard "Guardar y cerrar"

`disabled={saving || notasLen > MAX_NOTAS || pendingSuggestion !== null}` con microcopy adyacente ("Decide qué hacer con la sugerencia antes de guardar") y `title` para tooltip nativo.

### Casos borde resueltos

1. **X / ESC / click fuera con `pendingSuggestion` activo.**
   Interceptor local `handleOpenChange(next)` que si `!next && pendingSuggestion !== null` dispara `window.confirm("Tienes una sugerencia de la IA sin decidir. Si cierras ahora, se descartará.")`. Cancelar → no cierra. Confirmar → limpia estado + `onOpenChange(false)`. Se pasa este wrapper al `<Dialog>` en lugar del `onOpenChange` prop directo.
2. **Reintento devuelve marcador canónico.** La edge ya sanitiza con `OverrideSchema.safeParse`. Si falla, `notas_sugeridas: ""` — misma ruta que "sin cambios": `toast.info`, propuesta previa intacta.
3. **Archivo (no textarea).** `handleFile` mantiene aplicación directa a `notas`. El punto de decisión aplica solo a rescate desde marcador canónico (documentado en comentario).
4. **Aplicar cuando `notas` ya tenía contenido.** Sobrescribe. Es la semántica esperada al decidir "Aplicar".

## 2. Reordenar cierre en `handleSave`

Cambio de:
```ts
toast.success(...); onSaved(payload); onOpenChange(false);
```
a:
```ts
onOpenChange(false); onSaved(payload); toast.success(...);
```

**Toast tras desmontar es seguro:** `<Sonner />` en `App.tsx:37` vive fuera del árbol del Dialog. `toast.success` es side effect global sobre la store de Sonner — no requiere que el componente que la invoca siga montado.

**Regresiones evaluadas:**
- ¿`onSaved`/`invalidateQueries` no corre si el usuario navega rápido? No — `onSaved` es síncrono al invocarse; la invalidación de React Query dispara refetches en el padre (`CancelacionValidar.tsx`) que tiene el `queryClient`, no en el modal.
- ¿Race con `pointer-events` de Radix? Al invertir, la animación de salida empieza antes de que el padre re-renderice por invalidación — elimina la ventana donde Radix restauraba pointer-events sobre un árbol ya cambiado. Es el efecto deseado.

Sin `queueMicrotask` — el reorden simple basta.

## Tests de regresión

`src/components/cancelaciones/prosa/__tests__/ProsaApoderadoModal.test.tsx` — nuevo, RTL + user-event, mocks de `supabase.functions.invoke`, `supabase.from().update().eq()` y `sonner`. Polyfill local de `ResizeObserver` (Radix ScrollArea). `ProsaLiveRenderer` mockeado para exponer `notas_adicionales` del override recibido.

1. **Rescate → pendingSuggestion visible, `notas` intacto, Guardar disabled.**
2. **Aplicar** → textarea contiene la sugerencia, bloque desaparece, Guardar habilitado, `toast.success`.
3. **Descartar** → textarea conserva pegado original, bloque desaparece.
4. **Reintentar con comentario** → `invoke` llamado con `rawText` que contiene el texto pegado + `"Ajuste solicitado por el usuario: ..."`, nueva propuesta reemplaza a la previa, `retryComment` se limpia.
5. **Reintento vacío** → `toast.info`, propuesta previa sigue.
6. **Cerrar con pendingSuggestion**: `confirm=false` → `onOpenChange` NO llamado; `confirm=true` → sí.
7. **Camino feliz orden de cierre** → `invocationCallOrder`: `onOpenChange` < `onSaved` < `toast.success`.

## Aislamiento

- `src/components/cancelaciones/prosa/ProsaApoderadoModal.tsx`
- `src/components/cancelaciones/prosa/__tests__/ProsaApoderadoModal.test.tsx` (nuevo)

Sin tocar schema compartido, edge, otros bancos ni `CancelacionValidar.tsx`.

## Detalles técnicos

- `MAX_NOTAS=2000`, `MAX_RETRY_COMMENT=240`, `MAX_RAW_TEXT=8000` (defensa en profundidad; edge trunca igual).
- Reset de los 4 estados nuevos en `useEffect([open, currentOverride])`.
- Interceptor `handleOpenChange` **wrappea** la prop, no la reemplaza.
