# Plan: UI-1.4 — Badge "Con alertas" → "Alertas"

## Cambio
En `src/pages/Cancelaciones.tsx`, el componente `ManualReviewChip` muestra el texto visible `"Con alertas"`. Se cambiará a `"Alertas"` (una sola palabra) para evitar que el badge se parta en dos líneas.

## Límites explícitos
- **Solo** el texto visible dentro del `<Badge>` de `ManualReviewChip` cambia.
- El `aria-label` `"Con alertas históricas de revisión manual"`, el ícono `<AlertTriangle />`, el `<Tooltip>`, el `<TooltipContent>` y toda la lógica quedan intactos.
- No se tocan otros componentes ni consumidores de `Badge`.

## Archivos a modificar

### 1. `src/pages/Cancelaciones.tsx`
Línea 93, texto visible dentro de `ManualReviewChip`.

```diff
 const ManualReviewChip = () => (
   <Tooltip>
     <TooltipTrigger asChild>
       <Badge
         className="gap-1 border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-50 cursor-help"
         aria-label="Con alertas históricas de revisión manual"
       >
         <AlertTriangle className="h-3 w-3" />
-        Con alertas
+        Alertas
       </Badge>
     </TooltipTrigger>
     <TooltipContent className="max-w-xs text-xs leading-snug">
       En algún momento uno o más campos quedaron marcados como poco legibles y fueron confirmados manualmente. Esta marca se conserva solo para trazabilidad histórica.
     </TooltipContent>
   </Tooltip>
 );
```

### 2. `src/pages/Cancelaciones.test.tsx`
Tres aserciones usan `getByText`/`queryByText` con el literal `"Con alertas"`. Se actualizan a `"Alertas"`.

```diff
     const row = screen.getByText("MAT-9dc33048").closest("tr")!;
     expect(within(row).getByText("Completada")).toBeInTheDocument();
-    expect(within(row).getByText("Con alertas")).toBeInTheDocument();
+    expect(within(row).getByText("Alertas")).toBeInTheDocument();
```

```diff
     expect(within(screen.getByText("R-ERR").closest("tr")!).getByText("Error")).toBeInTheDocument();
 
-    expect(screen.queryByText("Con alertas")).not.toBeInTheDocument();
+    expect(screen.queryByText("Alertas")).not.toBeInTheDocument();
     expect(screen.queryByText("Bloqueada")).not.toBeInTheDocument();
```

```diff
     const row = screen.getByText("MAT-NODUP").closest("tr")!;
     expect(within(row).getByText("Bloqueada")).toBeInTheDocument();
-    expect(within(row).queryByText("Con alertas")).not.toBeInTheDocument();
+    expect(within(row).queryByText("Alertas")).not.toBeInTheDocument();
```

## Verificación
1. Ejecutar `bunx vitest run src/pages/Cancelaciones.test.tsx` para confirmar que los tests del módulo pasan.
2. Ejecutar el suite completo de Vitest (`bunx vitest run`) para confirmar que no hay regresiones.
3. Reportar totales exactos de tests pasados.

## Rollback
El cambio es reversible con un solo revert: restaurar `"Con alertas"` en las mismas líneas.