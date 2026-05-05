## Problema
El botón "Debug" en la barra superior de `/tramite/:id` (Validacion.tsx, líneas 3180-3204) aparece con fondo blanco, ícono emoji 🐞 y texto "Debug" siempre visible, rompiendo el design system Dark Glassmorphism (azul notarial / oro / superficies oscuras translúcidas).

## Cambios

### 1. `src/pages/Validacion.tsx` (líneas 3180-3204)
Refactor del botón toggle de depuración:

- Reemplazar emoji `🐞` por ícono **`Bug`** de `lucide-react` (ya disponible en el modal). Agregar `Bug` al import existente de la línea 12.
- Eliminar el `<span>` con texto "Debug" / "Debug ON" del botón. El texto vivirá únicamente en el `TooltipContent`.
- Cambiar a `size="icon"` y `className="h-9 w-9 shrink-0"` (consistente con los icon-only del `DocxDebugModal`).
- Aplicar variantes coherentes con el design system:
  - **OFF** (estado default): `variant="outline"` + clases `border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white hover:border-notarial-gold/40` (glass sutil).
  - **ON** (estado activo): clases `bg-notarial-gold/15 border-notarial-gold/50 text-notarial-gold hover:bg-notarial-gold/25` para indicar inequívocamente que está activo (dorado institucional, no blanco).
  - Ícono `Bug` con `className="h-4 w-4"` heredando `currentColor`.
- Mantener `aria-label` dinámico ("Activar depuración .docx" / "Desactivar depuración .docx") para accesibilidad.

### 2. Tooltip
Actualizar el `TooltipContent` para incluir tanto el estado actual como la descripción, en una línea legible:
- Texto: `Depuración .docx · {debugDocxOn ? "ON" : "OFF"}` en negrita arriba, y debajo la descripción "Audita variables del .docx tras generar".
- Mantener clases ya alineadas con design system: `bg-notarial-dark/95 border-white/10 text-white text-xs`.

## Notas
- No tocar `DocxDebugModal.tsx` (ya cumple icon-only + tooltip para Copiar/Descargar).
- No introducir colores nuevos; reutilizar tokens `notarial-gold`, `notarial-dark`, `white/N` ya en uso.
- Cambio no-bloqueante, puramente visual; no afecta lógica de toggle ni del audit payload.