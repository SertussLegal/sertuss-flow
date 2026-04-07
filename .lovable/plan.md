

## ✅ Completado: Edición Semántica por Anclaje

Sistema de Custom Variables reemplazado por TextOverride con edición in-place directa.

### Cambios realizados

| Archivo | Cambio |
|---|---|
| `src/lib/types.ts` | `TextOverride` interface añadida, `CustomVariable` marcada deprecated |
| `src/components/tramites/InlineEditToolbar.tsx` | Nuevo — toolbar flotante con input directo, validación y soporte multi-ocurrencia |
| `src/components/tramites/SelectionToolbar.tsx` | Eliminado |
| `src/components/tramites/DocxPreview.tsx` | Props migrados a `overrides`, pipeline con anclaje contextual, panel "Cambios" en nav bar |
| `src/pages/Validacion.tsx` | Estado `overrides`, migración legacy, algoritmo DOCX robusto con virtualización XML |

### Diferenciación visual
- Template vars resueltas: verde `#065f46`, borde dashed verde
- Overrides del usuario: púrpura `#4c1d95`, borde dashed `#7c3aed`
- Sugerencias IA: naranja/azul `<mark>`
