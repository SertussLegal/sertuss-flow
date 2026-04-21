

## Header Validación — Implementación con sistema de diseño existente

### Principio
Cero invención visual. Solo tokens y componentes ya establecidos en el proyecto.

### Inventario obligatorio (lo que YA existe y se usa)

**Iconos `lucide-react`** (ya importados en `Validacion.tsx`):
- `ArrowLeft` — back
- `Edit3` — affordance edición chip Radicado
- `FolderOpen` — chip Documentos
- `Save` — guardar borrador
- `Eye` — Previsualizar
- `Loader2` — sync `saving` (con `animate-spin` ya establecido)
- `Check` — sync `saved`
- `Cloud` — sync `idle`
- `Coins` — chip Créditos (ya usado en el proyecto para créditos)

**Componentes UI** (`src/components/ui/*`, ya en uso):
- `Button` con variantes existentes: `ghost-dark` (para icon-only sobre fondo oscuro), `default`. Sin variantes nuevas.
- `Input` estándar
- `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` (Radix, ya configurado)
- `Badge` variant `outline` para chips estáticos

**Tokens de color del sistema** (`tailwind.config.ts` + `index.css`, NO hex sueltos):
- Fondo header: `bg-notarial-dark/80` + `backdrop-blur-md`
- Borde inferior: `border-b border-white/5`
- Chips fondo base / hover: `bg-white/5` → `hover:bg-white/10`
- Borde chips: `border-white/10`
- Texto principal: `text-white`, atenuado: `text-white/60`, placeholder italic: `text-white/40`
- Botón primario: `bg-notarial-gold hover:bg-notarial-gold/90 text-notarial-dark` (token `notarial-gold` ya en config)
- Tooltip: `bg-notarial-dark/95 border border-white/10 text-white`

### Cambios

**`src/pages/Validacion.tsx`** (único archivo)

1. Header `h-12`, `sticky top-0 z-50`, `bg-notarial-dark/80 backdrop-blur-md border-b border-white/5`, `flex items-center justify-between px-4`.

2. Izquierda (`gap-x-3`):
   - `<Button variant="ghost-dark" size="icon" className="h-8 w-8">` con `<ArrowLeft />` + Tooltip "Dashboard".
   - `<span className="text-white/90 text-sm font-medium">Validación</span>` + separador `<span className="text-white/30">·</span>`.
   - **Chip Radicado** (`group` wrapper, `w-[180px] h-8`):
     - Estado vista: `<button className="group w-[180px] h-8 px-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center justify-between text-sm">` con texto + `<Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />`.
     - Si vacío: texto `[Sin Radicado]` con `text-white/40 italic`.
     - Estado edición: `<Input className="w-[180px] h-8" autoFocus />` mismas dimensiones → cero shift.

3. Derecha (`gap-x-4`):
   - Chip Documentos: `<button className="h-8 px-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2 text-sm">` + `<FolderOpen className="h-4 w-4" />` + `{n}/{total}`. Tooltip dinámico **`Gestión de Expediente ({n} de {total} documentos)`**. Click → abre `ExpedienteSidebar`.
   - Chip Créditos: misma estructura con `<Coins className="h-4 w-4 text-notarial-gold" />` + número. Tooltip "Créditos disponibles".
   - Sync indicator: `<Button variant="ghost-dark" size="icon" className="h-8 w-8">` con icono según estado (`Loader2 animate-spin` / `Check` / `Cloud`) + Tooltip dinámico ("Guardando…" / "Guardado · hace {X}" / "Sin cambios pendientes"). Estado `saving` se dispara también al editar Radicado.
   - `<Button variant="ghost-dark" size="icon" className="h-8 w-8">` con `<Save />` + Tooltip "Guardar borrador ahora".
   - **Previsualizar** (primario, único con texto): `<Button className="bg-notarial-gold hover:bg-notarial-gold/90 text-notarial-dark font-medium px-6 h-9">` + `<Eye />` + "Previsualizar".

4. **Tooltips Radix** consistentes — todos con:
   ```tsx
   <TooltipContent sideOffset={8} className="bg-notarial-dark/95 border border-white/10 text-white text-xs px-2.5 py-1.5">
   ```
   Envolver el header en un único `<TooltipProvider delayDuration={200}>`.

5. **Sincronización de altura** — buscar y reemplazar TODAS las referencias en el archivo:
   - `h-screen`, `min-h-screen`, `calc(100vh - 3.5rem)`, `calc(100vh - 56px)` → `h-[calc(100vh-3rem)]` o `calc(100vh - 3rem)`.
   - Verificar contenedores hijos: panel formularios, `DocxPreview`, `ExpedienteSidebar`.

6. **Limpieza** — eliminar:
   - Label estático "RADICADO".
   - Input de radicado siempre visible.
   - Palabra "créditos" del badge dorado (queda solo el número).
   - Cualquier hex suelto introducido en iteraciones previas que no use tokens.

### Verificación
1. Cero clases con hex (`#XXXXXX`) en el header — todo vía tokens (`notarial-gold`, `notarial-dark`, `white/X`). ✅
2. Iconos: `ArrowLeft`, `Edit3`, `FolderOpen`, `Coins`, `Loader2`, `Check`, `Cloud`, `Save`, `Eye` — todos `lucide-react` ya importados. ✅
3. Botón primario usa `bg-notarial-gold` (token), no hex. ✅
4. Tooltips usan componente `Tooltip*` de `ui/tooltip.tsx`, no markup custom. ✅
5. Icon-only buttons usan `<Button variant="ghost-dark" size="icon">` existente. ✅
6. Trámite nuevo → chip muestra `[Sin Radicado]`. Recuperado → muestra valor. ✅
7. Hover chip Radicado → `bg-white/10` + `Edit3` visible. ✅
8. Click chip → `Input` mismo `w-[180px] h-8`, cero shift. ✅
9. Editar Radicado → sync pasa a `Guardando…` → `Guardado · hace un momento`. ✅
10. Visor + sidebar usan `calc(100vh - 3rem)` sin gap. ✅

### Archivo modificado (1)
`src/pages/Validacion.tsx` — header rediseñado + sincronización de altura. ~120 líneas.

### Lo que NO se toca
Lógica de auto-save 15s, sync, créditos, validación, `manualFieldOverrides`, `ExpedienteSidebar`, formularios, popovers, `tailwind.config.ts`, `index.css`. Solo header y altura.

### Riesgos
Mínimos. Reutilización estricta de tokens y componentes ya en producción.

