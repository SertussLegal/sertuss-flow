# Fix B/UI-1.1 — Estados vacíos distintos en listado de Cancelaciones

## Diagnóstico

En `src/pages/Cancelaciones.tsx` (versión desplegada de hoy) hay una sola variable `hasRows = filteredRows.length > 0` (L140). Como se evalúa después del filtro, dos estados distintos se confunden:

1. **Cuenta 100% vacía** (`rows.length === 0`) → hoy muestra el mensaje correcto: "No hay cancelaciones registradas aún".
2. **Cuenta con filas, pero el filtro activo no coincide** (`rows.length > 0 && filteredRows.length === 0`) → hoy cae al mismo `!hasRows` y muestra el mensaje genérico de cuenta vacía, lo cual es incorrecto.

Además, los `<Tabs>` se renderizan siempre (L160-166), incluso cuando `counts.all === 0`.

## Cambios propuestos

### 1. `src/pages/Cancelaciones.tsx`

#### 1.1 Variables de estado

Reemplazar L140:

```tsx
const hasRows = filteredRows.length > 0;
```

Por:

```tsx
const hasAnyRow = rows.length > 0;
const hasRows = filteredRows.length > 0;
```

#### 1.2 Renderizado condicional

Reemplazar el bloque de renderizado L158-184:

```tsx
<div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
  <h2 className="text-lg font-semibold">Historial de Cancelaciones</h2>
  <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
    <TabsList>
      <TabsTrigger value="all">Todas ({counts.all})</TabsTrigger>
      <TabsTrigger value="review">Requieren revisión ({counts.review})</TabsTrigger>
      <TabsTrigger value="completed">Completadas ({counts.completed})</TabsTrigger>
    </TabsList>
  </Tabs>
</div>
{isInitialLoading ? (
  <div data-testid="page-skeleton" className="space-y-3 p-6">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
) : !hasRows ? (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
      <FileSearch className="h-6 w-6 text-muted-foreground" />
    </div>
    <h2 className="text-base font-semibold">No hay cancelaciones registradas aún</h2>
    <p className="max-w-sm text-sm text-muted-foreground">
      Cuando inicies un trámite de cancelación de hipoteca, aparecerá aquí su historial completo.
    </p>
  </div>
) : (
```

Por:

```tsx
<div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
  <h2 className="text-lg font-semibold">Historial de Cancelaciones</h2>
  {hasAnyRow && (
    <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
      <TabsList>
        <TabsTrigger value="all">Todas ({counts.all})</TabsTrigger>
        <TabsTrigger value="review">Requieren revisión ({counts.review})</TabsTrigger>
        <TabsTrigger value="completed">Completadas ({counts.completed})</TabsTrigger>
      </TabsList>
    </Tabs>
  )}
</div>
{isInitialLoading ? (
  <div data-testid="page-skeleton" className="space-y-3 p-6">
    {Array.from({ length: 4 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
) : !hasAnyRow ? (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
      <FileSearch className="h-6 w-6 text-muted-foreground" />
    </div>
    <h2 className="text-base font-semibold">No hay cancelaciones registradas aún</h2>
    <p className="max-w-sm text-sm text-muted-foreground">
      Cuando inicies un trámite de cancelación de hipoteca, aparecerá aquí su historial completo.
    </p>
  </div>
) : !hasRows ? (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
      <FileSearch className="h-6 w-6 text-muted-foreground" />
    </div>
    <h2 className="text-base font-semibold">No hay cancelaciones que coincidan con este filtro</h2>
    <p className="max-w-sm text-sm text-muted-foreground">
      Prueba con otro filtro o vuelve a "Todas" para ver el historial completo.
    </p>
  </div>
) : (
```

### 2. `src/pages/Cancelaciones.test.tsx`

Agregar un quinto test al final del `describe`:

```tsx
it("cuenta con filas pero filtro vacío muestra mensaje de filtro, no mensaje de cuenta vacía", async () => {
  setRows([
    baseRow({ matricula_inmobiliaria: "CLEAN-DONE", status: "completed", revision_manual_requerida: false }),
  ]);
  await renderPage("CLEAN-DONE");

  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Requieren revisión/i }));

  expect(screen.queryByText("CLEAN-DONE")).not.toBeInTheDocument();
  expect(screen.getByText("No hay cancelaciones que coincidan con este filtro")).toBeInTheDocument();
  expect(screen.queryByText("No hay cancelaciones registradas aún")).not.toBeInTheDocument();
});
```

## Criterios de aceptación

- [ ] `hasAnyRow` y `hasRows` coexisten como variables separadas.
- [ ] Los `<Tabs>` no se renderizan cuando `counts.all === 0`.
- [ ] Cuenta vacía real muestra "No hay cancelaciones registradas aún".
- [ ] Cuenta con filas pero filtro sin coincidencias muestra "No hay cancelaciones que coincidan con este filtro".
- [ ] El test nuevo pasa y no rompe los 4 tests existentes.
- [ ] Vitest sigue en 225/225 y Deno en 66/66.

## Fuera de alcance

- Cambios de lógica de negocio, backend, migraciones o comportamiento de filtrado.
- Modificar mensajes de otros estados de error/carga.
