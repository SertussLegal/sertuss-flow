

## Análisis QA del flujo de borradores

### Estado actual en la base de datos

Hay **2 borradores pendientes**:
1. `fb139817` — Creado el 28 mar, **sin metadata de progreso**, sin personas ni inmuebles. Es un borrador huérfano creado al navegar a `/nuevo-tramite` y presionar "Continuar" sin datos útiles.
2. `de0a906c` — Creado el 16 mar, con progreso 80%, tiene 2 personas. Este tiene más de 14 días y será purgado pronto por el cron.

Ninguno tiene registros en `logs_extraccion`, así que la eliminación manual **no debería fallar** por foreign keys.

### Problemas identificados

**Problema 1: Borrador se crea al dar "Continuar" sin validación suficiente**
En `DocumentUploadStep.tsx` línea 225, al presionar "Continuar" se hace `INSERT INTO tramites` inmediatamente, sin importar si se subieron documentos o no. Si el usuario luego se devuelve al Dashboard, queda un borrador vacío.

**Problema 2: El botón de eliminar (basura) no funciona correctamente**
El `handleDeleteDraft` en Dashboard.tsx no elimina `logs_extraccion` antes de intentar borrar el trámite. Aunque ahora no hay registros de logs para estos borradores, cuando el flujo completo funcione sí los habrá, y el DELETE fallará silenciosamente por la dependencia.

**Problema 3: Sin CASCADE en tablas dependientes**
Las tablas `personas`, `inmuebles`, `actos` y `logs_extraccion` **no tienen foreign keys definidas** hacia `tramites` (confirmado en el schema). La función `purge_expired_drafts` y `handleDeleteDraft` eliminan manualmente de cada tabla, pero si se agrega alguna tabla nueva relacionada, se rompe.

### Plan de corrección

| # | Cambio | Archivo |
|---|--------|---------|
| 1 | **Agregar `logs_extraccion` al delete manual** | `src/pages/Dashboard.tsx` |
| 2 | **No crear trámite si no hay al menos 1 documento procesado** | `src/components/tramites/DocumentUploadStep.tsx` |
| 3 | **Agregar `logs_extraccion` a `purge_expired_drafts()`** | Migración SQL |
| 4 | **Limpiar los 2 borradores huérfanos actuales** | Migración SQL (DELETE) |

### Detalle técnico

**Dashboard.tsx** — Agregar antes de eliminar personas:
```typescript
await supabase.from("logs_extraccion").delete().eq("tramite_id", draftToDelete.id);
```

**DocumentUploadStep.tsx** — Deshabilitar "Continuar" si ningún slot tiene `status: "done"`:
```typescript
const hasAnyProcessed = allSlots.some(s => s.status === "done");
// Botón Continuar disabled={!hasAnyProcessed}
```

**Migración SQL** — Actualizar `purge_expired_drafts`:
```sql
DELETE FROM public.logs_extraccion WHERE tramite_id IN (
  SELECT id FROM public.tramites WHERE status = 'pendiente' AND updated_at < now() - interval '15 days'
);
```