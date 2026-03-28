

## Plan: Corregir eliminación de borradores + implementar auto-purga

### Problema 1: Delete silencioso
El `handleDeleteDraft` en Dashboard.tsx remueve la tarjeta del estado local **antes** de confirmar que la DB lo eliminó. Si falla, la tarjeta reaparece al recargar.

### Problema 2: Sin auto-purga
No existe lógica backend para eliminar borradores inactivos tras 15 días. Solo es texto decorativo en la UI.

---

### Cambios

**1. `src/pages/Dashboard.tsx` — Corregir handleDeleteDraft**
- Verificar el `error` del delete de `tramites` antes de actualizar el estado local
- Solo llamar `setTramites(prev => prev.filter(...))` si el delete fue exitoso
- Mostrar el error real si falla

**2. Migración SQL — Crear función de purga automática**
- Crear función `purge_expired_drafts()` que elimine tramites con `status = 'pendiente'` y `updated_at < now() - interval '15 days'`
- También elimina sus personas, inmuebles y actos asociados
- Se ejecuta con `SECURITY DEFINER` para bypassear RLS

**3. Cron job via `pg_cron`**
- Programar `purge_expired_drafts()` para ejecutarse diariamente a las 3:00 AM UTC
- `SELECT cron.schedule('purge-expired-drafts', '0 3 * * *', 'SELECT purge_expired_drafts()')`

**4. Eliminar el borrador huérfano actual**
- Ejecutar una limpieza manual del borrador `8831f06c` que el usuario ya intentó eliminar (si confirma)

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/Dashboard.tsx` | Verificar resultado de delete antes de actualizar estado |
| Migración SQL | Crear `purge_expired_drafts()` + cron schedule |

