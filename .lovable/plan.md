# Fix UX ProsaApoderadoModal — Punto de decisión + orden de cierre

## Diagnóstico

**Toaster fuera del Dialog.** `src/App.tsx:36-37` monta `<Toaster />` y `<Sonner />` al nivel de `App`, encima de `<BrowserRouter>` y por lo tanto fuera de cualquier `<DialogContent>`. Un `toast.success` sobrevive al desmontaje del modal sin problema — el reorden es seguro.

**Preview reactiva.** `ProsaLiveRenderer` recibe `override` por prop y usa `useMemo([base, override, section])`. Basta pasarle un `previewOverride` distinto para reflejar la sugerencia pendiente sin duplicar componentes.

**Edge tolera reintento.** `adaptar-estilo-prosa` acepta `rawText` de hasta 8000 chars. Concatenar el comentario del usuario al final del `rawText` original con un separador cabe en el mismo contrato — sin cambios de edge.

## 1. Punto de decisión explícito para sugerencia IA

### Estado nuevo (`ProsaApoderadoModal.tsx`)

```ts
const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(null);
const [retryComment, setRetryComment] = useState("");
const [lastRawText, setLastRawText] = useState<string | null>(null); // para reintento
const [showOriginal, setShowOriginal] = useState(false);             // colapsable
```

Nota: guardamos también el `rawText` original que dio origen a la sugerencia para poder reintentar concatenando el comentario sin depender de `rescueText` (que sigue siendo el trigger inicial desde textarea) ni del archivo (para archivos, deshabilitamos reintento — ver casos borde).

### `handleRescueAsReference` (rediseñado)

```ts
async function handleRescueAsReference() {
  const src = rescueText?.trim();
  if (!src) return;
  setAiLoading(true);
  try {
    const { data, error } = await supabase.functions.invoke("adaptar-estilo-prosa", {
      body: { rawText: src, baseContext },
    });
    if (error) throw error;
    const notasSug = (data as { notas_sugeridas?: string })?.notas_sugeridas ?? "";
    if (!notasSug.trim()) { toast.info("La IA no extrajo notas reutilizables"); return; }
    setPendingSuggestion(notasSug.slice(0, MAX_NOTAS));
    setLastRawText(src);
    setRescueText(null); // ya no necesitamos la banda de rescate
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Error de IA");
  } finally { setAiLoading(false); }
}
```

**Clave:** NO tocamos `notas` hasta que el usuario decida.

### Preview con sugerencia aplicada

Reemplazar el `previewOverride` que se pasa al panel izquierdo cuando hay sugerencia pendiente:

```ts
const displayOverride: ProsaApoderadoOverride = pendingSuggestion
  ? { ...previewOverride, notas_adicionales: pendingSuggestion }
  : previewOverride;
```

El `ProsaLiveRenderer` ya pinta la banda dorada con las `notas_adicionales` — el usuario ve inmediatamente cómo queda el bloque canónico + notas sugeridas.

### UI (dentro de la columna derecha, reemplaza la banda de rescate cuando `pendingSuggestion` está activo)

```text
┌─ Sugerencia de la IA (pendiente de tu decisión) ────────────┐
│ [▸ Ver texto original que pegaste]  (colapsable)             │
│                                                              │
│ Propuesta IA:                                                │
│ ┌──────────────────────────────────────────────────────┐    │
│ │ <pendingSuggestion, readonly, whitespace-pre-wrap>    │    │
│ └──────────────────────────────────────────────────────┘    │
│ Mira el panel izquierdo para ver cómo quedaría aplicada.     │
│                                                              │
│ [ Aplicar ]  [ Descartar ]                                   │
│                                                              │
│ ─ Reintentar con un comentario ─                             │
│ [ input una línea: "Más formal, menciona..."         ] [→]   │
└──────────────────────────────────────────────────────────────┘
```

### Handlers

- **Aplicar:** `setNotas(pendingSuggestion!); setPendingSuggestion(null); setRetryComment(""); setLastRawText(null); setShowOriginal(false); toast.success("Sugerencia aplicada")`.
- **Descartar:** `setPendingSuggestion(null); setRetryComment(""); setLastRawText(null); setShowOriginal(false)`. `notas` queda como estaba (posiblemente vacío si el usuario nunca escribió nada propio antes de pegar).
- **Reintentar:** `handleRetryWithComment()`:
  ```ts
  const comment = retryComment.trim();
  if (!comment || !lastRawText) return;
  const combined = `${lastRawText}\n\n---\nAjuste solicitado por el usuario: ${comment}`.slice(0, 8000);
  setAiLoading(true);
  try {
    const { data, error } = await supabase.functions.invoke("adaptar-estilo-prosa", {
      body: { rawText: combined, baseContext },
    });
    if (error) throw error;
    const notasSug = (data as { notas_sugeridas?: string })?.notas_sugeridas ?? "";
    if (!notasSug.trim()) { toast.info("La IA no cambió su propuesta"); return; }
    setPendingSuggestion(notasSug.slice(0, MAX_NOTAS));
    setRetryComment("");
  } catch (err) { toast.error(...); }
  finally { setAiLoading(false); }
  ```

### Guard "Guardar y cerrar"

```tsx
<Button
  disabled={saving || notasLen > MAX_NOTAS || pendingSuggestion !== null}
  title={pendingSuggestion !== null ? "Decide qué hacer con la sugerencia antes de guardar" : undefined}
  ...
>
```

Mostrar un microcopy pequeño junto al botón cuando esté deshabilitado por este motivo (accesibilidad: no depender solo del title).

### Casos borde — resueltos

1. **Usuario cierra el modal (X) con `pendingSuggestion` activo.**
   Envolver `onOpenChange` externo con un interceptor local:
   ```ts
   function handleOpenChange(next: boolean) {
     if (!next && pendingSuggestion !== null) {
       const ok = window.confirm(
         "Tienes una sugerencia de la IA sin decidir. Si cierras ahora, se descartará."
       );
       if (!ok) return;
       // usuario confirmó: limpiar sugerencia y cerrar
       setPendingSuggestion(null); setRetryComment(""); setLastRawText(null);
     }
     onOpenChange(next);
   }
   ```
   Se pasa `handleOpenChange` al `<Dialog>` en lugar de `onOpenChange` directo. Aplica también a click fuera y ESC (Radix los canaliza por el mismo callback).

2. **Reintento devuelve texto con marcador canónico.**
   La edge sanitiza con `OverrideSchema.safeParse` antes de devolver `notas_sugeridas`. Si falla, la respuesta trae `notas_sugeridas: ""` o `warning`. En ese caso: `toast.info("La IA propuso algo inválido — intenta con otro comentario")`, `pendingSuggestion` queda como estaba (la propuesta previa sigue visible), `retryComment` se conserva para que el usuario lo edite. NO se muestra JSON crudo — la ruta es la misma que la de "no extrajo notas".

3. **`rescueText` de un archivo (no de textarea).** El flujo actual de archivo llama `handleFile` que **hoy sí** aplica directo a `notas`. Se mantiene ese comportamiento (los archivos no vienen de un intento fallido de pegar canónico) — el punto de decisión aplica **solo** al camino de rescate desde marcador canónico. Documentar en comentario.

4. **Aplicar cuando `notas` ya tenía contenido:** se sobrescribe. Es el comportamiento esperado (la sugerencia reemplaza, no anexa). El usuario acaba de decidir explícitamente "Aplicar".

### Efecto de reset

Extender el `useEffect([open])` para limpiar `pendingSuggestion`, `retryComment`, `lastRawText`, `showOriginal` al abrir/cerrar.

## 2. Reordenar cierre en `handleSave`

Cambiar el camino feliz de:
```ts
toast.success(...);
onSaved(payload);
onOpenChange(false);
```
a:
```ts
onOpenChange(false);
onSaved(payload);
toast.success(isEmpty ? "Personalización eliminada" : "Personalización guardada");
```

**Verificación de toast tras desmontar:** `<Sonner />` vive en `App.tsx:37`, fuera de `<BrowserRouter>` y por lo tanto fuera del árbol del `Dialog`. Sonner mantiene su propia store; llamar `toast.success` desde un componente que se está desmontando funciona porque la función es un side effect global, no un efecto de React. Confirmado seguro.

**Regresión potencial evaluada:**
- ¿`onSaved` (invalidateQueries) podría no correr si el usuario navega rápido? No: `onSaved` es síncrono al invocarse (la invalidación de React Query dispara refetches pero no requiere que el modal siga montado). El padre (`CancelacionValidar.tsx`) es quien tiene el `queryClient`, no el modal.
- ¿Race con Radix limpiando `pointer-events`? Al invertir el orden, la animación de salida del Dialog empieza antes de que el padre re-renderice por invalidación, eliminando la ventana donde Radix restaura pointer-events sobre un árbol ya cambiado. Es exactamente lo que queremos.

**No usamos `queueMicrotask`** — el reorden simple es suficiente y más legible.

## Tests de regresión (`src/components/cancelaciones/prosa/__tests__/ProsaApoderadoModal.test.tsx`)

Nuevo archivo con React Testing Library, mockeando `supabase.functions.invoke` y `supabase.from(...).update(...)`.

Casos:

1. **Rescate → pendingSuggestion aparece, no toca notas.** Pegar texto con "COMPARECIÓ:", clic Guardar → banda rescate → clic "Usar como referencia" (mock devuelve `notas_sugeridas: "estilo formal..."`) → assert que aparece bloque "Sugerencia de la IA", que el textarea sigue con el texto original pegado, que el botón "Guardar y cerrar" está `disabled`.
2. **Aplicar.** Desde estado (1), clic Aplicar → assert textarea ahora contiene `"estilo formal..."`, bloque de sugerencia desaparece, Guardar habilitado, toast success visible.
3. **Descartar.** Desde (1), clic Descartar → assert textarea conserva el texto original pegado, bloque desaparece, Guardar sigue deshabilitado (porque el textarea aún contiene "COMPARECIÓ:" — validación al guardar volvería a fallar; ok, ese es un caso distinto que el usuario debe editar manualmente).
4. **Reintentar con comentario.** Desde (1), escribir "más formal" en input reintento, clic → assert `supabase.functions.invoke` llamado con `rawText` que incluye el texto original + `"Ajuste solicitado por el usuario: más formal"`, `pendingSuggestion` se actualiza a la nueva propuesta, `retryComment` se limpia.
5. **Reintento devuelve vacío.** Mock devuelve `notas_sugeridas: ""` → assert `toast.info` llamado, `pendingSuggestion` sigue mostrando la propuesta previa.
6. **Cerrar (X) con pendingSuggestion.** Spy en `window.confirm` (return `false`) → intentar cerrar → assert `onOpenChange` externo NO se llamó, sugerencia sigue visible. Segundo caso: `confirm` return `true` → `onOpenChange(false)` llamado, estado limpio.
7. **Camino feliz orden de cierre.** Escribir nota válida, clic Guardar → assert orden de llamadas: primero `onOpenChange(false)`, luego `onSaved(payload)`, luego `toast.success`. Verificable con `vi.fn().mock.invocationCallOrder`.
8. **Toaster fuera del Dialog** (test estructural liviano): montar `<App />` mínimo o assert que el componente Toaster no está dentro del árbol del DialogContent. Alternativa más simple: confirmar en el test (7) que `toast.success` se llama después del desmontaje del DialogContent (el spy sobre `toast.success` recibe la llamada; el hecho de que sonner lo renderice fuera se asume por su implementación).

Total: ~8 tests nuevos en un solo archivo. Suite completo debe seguir en 22 files / 265 tests aprox.

## Aislamiento

Todos los cambios viven en:
- `src/components/cancelaciones/prosa/ProsaApoderadoModal.tsx` (lógica + UI)
- `src/components/cancelaciones/prosa/__tests__/ProsaApoderadoModal.test.tsx` (nuevo)

Sin tocar schema compartido, edge, otros bancos ni `CancelacionValidar.tsx`.

## Detalles técnicos (no user-facing)

- Reset de estado en `useEffect([open])`: agregar los 4 estados nuevos a la limpieza existente.
- `MAX_NOTAS = 2000` sigue aplicando a `pendingSuggestion` vía `.slice(0, MAX_NOTAS)` al recibir.
- `MAX_RETRY_COMMENT = 240` chars en el input de reintento (defensa en profundidad; edge trunca a 8000 igual).
- Todos los `useState` nuevos van justo debajo de los existentes, sin refactor.
- El interceptor `handleOpenChange` NO reemplaza la prop `onOpenChange` del componente — es un wrapper local que sí llama a la prop original.
