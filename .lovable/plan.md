# Fix B/UI-1.2 — Rediseño de badges de revisión manual en Cancelaciones

## Diagnóstico

### Bug: doble badge redundante
Hoy en `src/pages/Cancelaciones.tsx` (L207-210) el render es:

```tsx
<StatusBadge status={row.status} />
{row.revision_manual_requerida && <ManualReviewChip />}
```

Cuando `status === 'requiere_revision_manual'`, la fila casi siempre también trae `revision_manual_requerida=true`, así que se pintan **dos badges diciendo lo mismo**:
- Rojo "Revisión manual bloqueante"
- Ámbar "Revisión manual"

Es el caso visto en la captura del usuario.

### Terreno de Tooltip
- `src/components/ui/tooltip.tsx` existe (shadcn estándar) y `TooltipProvider` ya envuelve toda la app en `src/App.tsx` L35 — no hay que agregarlo.
- Patrón ya en uso en `InlineBadgeDot.tsx`, `PersonaForm.tsx`, `InmuebleForm.tsx`, `Validacion.tsx`, etc. Reutilizable directo.
- Radix Tooltip: `TooltipTrigger asChild` sobre un `<span>` inline. El evento hover no dispara `onClick` del `<tr>` padre (son eventos distintos: `mouseenter`/`focus` vs `click`). El único cuidado es que si el usuario **hace click sobre el badge**, ese click SÍ burbujea al `<tr>` y navega — comportamiento actual y aceptable (el badge no es interactivo por sí mismo, solo informativo). No requiere `stopPropagation`.

## Propuesta de copy

| Caso | Texto visible | Tooltip |
|---|---|---|
| `status='requiere_revision_manual'` (badge rojo, bloqueante) | **"Bloqueada"** | "La IA no pudo leer con confianza uno o más campos obligatorios. El documento no se puede generar hasta que un humano revise y corrija los datos marcados." |
| `revision_manual_requerida=true` con status ya avanzado (chip ámbar, histórico) | **"Con alertas"** | "En algún momento uno o más campos quedaron marcados como poco legibles y fueron confirmados manualmente. Esta marca se conserva solo para trazabilidad histórica." |

Elección de palabras:
- **"Bloqueada"** > "Pendiente" porque comunica accionabilidad urgente ("hay algo que impide seguir") sin ambigüedad temporal.
- **"Con alertas"** > "Revisado" porque "Revisado" suena a estado positivo neutro y borra la señal de que hubo un problema histórico; "Con alertas" mantiene la trazabilidad visible sin alarmar.

## Cambios propuestos

### 1. `src/pages/Cancelaciones.tsx`

**Imports** — agregar `Tooltip`, `TooltipContent`, `TooltipTrigger`:

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

**`StatusBadge`** — cambiar el caso `requiere_revision_manual`:

```tsx
if (status === "requiere_revision_manual") {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge className="gap-1.5 border border-red-300 bg-red-100 text-red-800 hover:bg-red-100 cursor-help">
          <AlertTriangle className="h-3 w-3" />
          Bloqueada
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-snug">
        La IA no pudo leer con confianza uno o más campos obligatorios. El documento no se puede generar hasta que un humano revise y corrija los datos marcados.
      </TooltipContent>
    </Tooltip>
  );
}
```

**`ManualReviewChip`** — envolver con Tooltip y cambiar texto:

```tsx
const ManualReviewChip = () => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Badge
        className="gap-1 border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-50 cursor-help"
        aria-label="Con alertas históricas de revisión manual"
      >
        <AlertTriangle className="h-3 w-3" />
        Con alertas
      </Badge>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs text-xs leading-snug">
      En algún momento uno o más campos quedaron marcados como poco legibles y fueron confirmados manualmente. Esta marca se conserva solo para trazabilidad histórica.
    </TooltipContent>
  </Tooltip>
);
```

**Render de la celda de estado** (L204-211) — evitar duplicado:

```tsx
<TableCell>
  <div className="flex items-center gap-1.5">
    <StatusBadge status={row.status} />
    {row.revision_manual_requerida && row.status !== "requiere_revision_manual" && (
      <ManualReviewChip />
    )}
  </div>
</TableCell>
```

### 2. `src/pages/Cancelaciones.test.tsx`

Actualizar los tests que dependen del copy viejo:

- Test 1 (`chip 'Revisión manual' junto a badge 'Completada'`): reemplazar `"Revisión manual"` por `"Con alertas"`.
- Test 2 (`status='requiere_revision_manual' pinta badge rojo distintivo`): reemplazar `"Revisión manual bloqueante"` por `"Bloqueada"`.
- Test 4 (`estados existentes sin flag renderizan su badge original`): reemplazar los `queryByText("Revisión manual")` / `("Revisión manual bloqueante")` por `("Con alertas")` / `("Bloqueada")`.

Agregar test nuevo (sexto):

```tsx
it("cuando status='requiere_revision_manual' y flag=true, no duplica badges (solo 'Bloqueada')", async () => {
  setRows([
    baseRow({
      matricula_inmobiliaria: "MAT-NODUP",
      status: "requiere_revision_manual",
      revision_manual_requerida: true,
    }),
  ]);
  await renderPage("MAT-NODUP");

  const row = screen.getByText("MAT-NODUP").closest("tr")!;
  expect(within(row).getByText("Bloqueada")).toBeInTheDocument();
  expect(within(row).queryByText("Con alertas")).not.toBeInTheDocument();
});
```

Nota: los tests renderizan sin `TooltipProvider` explícito. Radix Tooltip permite `TooltipTrigger` sin provider en el árbol (fallback silencioso) — el `TooltipContent` no se abrirá en test, pero el `TooltipTrigger asChild` sí renderiza al `<Badge>` hijo con su texto, que es lo único que los tests verifican (`getByText("Bloqueada")` / `("Con alertas")`). No hace falta añadir provider al helper.

## Criterios de aceptación

- [ ] Fila con `status='requiere_revision_manual'` y `flag=true` muestra **una sola** badge ("Bloqueada"), no dos.
- [ ] Fila con `status='completed'` y `flag=true` muestra "Completada" + "Con alertas".
- [ ] Hover sobre "Bloqueada" o "Con alertas" muestra la explicación larga.
- [ ] Hover del badge no dispara navegación de la fila; click sobre el badge sí navega (comportamiento actual, aceptable).
- [ ] Los 5 tests existentes se actualizan al copy nuevo y siguen pasando.
- [ ] Test nuevo (no duplicación) pasa.
- [ ] Vitest 226/226, Deno 66/66.

## Fuera de alcance

- Cambios en lógica de filtros, backend, o cualquier otra columna/badge no relacionada con revisión manual.
- Añadir tests de apertura visual del Tooltip (requeriría user-event hover + jsdom timers; no aporta valor sobre el smoke visible).
