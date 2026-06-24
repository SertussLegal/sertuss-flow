# Plan: Reflejar toggles del SuperAdmin en vivo

## Problema
Cuando el SuperAdmin activa/desactiva un módulo desde `/admin/entidad/:id`, la mutación se persiste y queda auditada, pero `ModuleContext` solo refetchea cuando cambia `activeOrgId` o `userId`. Por eso el sidebar y los `ModuleGate` se quedan con la lista vieja hasta recargar.

## Solución (mínima, sin polling)
Hacer un broadcast del cambio y que `ModuleContext` revalide cuando el toggle afecta a la organización activa del usuario actual.

### 1. `src/pages/AdminOrgEdit.tsx`
- Tras un `admin_toggle_module` exitoso, llamar a `refreshModules()` del `useModules()` **solo si** la org editada (`id`) coincide con el `activeOrgId` del SuperAdmin (caso típico: está parado sobre su propia org).
- Cambiar el copy de la card de "se aplican en cuanto el usuario recarga la app" a "se aplican en vivo para los usuarios conectados a esta organización".

### 2. `src/contexts/ModuleContext.tsx`
- Agregar suscripción a Postgres Changes (`supabase.channel`) sobre `public.organization_modules` filtrada por `organization_id=eq.${activeOrgId}`. En cualquier `INSERT/UPDATE/DELETE` → llamar `fetchModules(activeOrgId, { silent: true })`.
  - Esto cubre a los **owners** de otras notarías: si el SuperAdmin les habilita/deshabilita un módulo, su sidebar se actualiza sin recargar.
  - Cleanup del channel al cambiar `activeOrgId` o desmontar.
- Mantener `refreshModules()` público para el caso 1 (refresco inmediato local cuando el SuperAdmin toca su propia org, sin esperar el round-trip de Realtime).

## Seguridad (sin cambios de schema)
- `admin_toggle_module` ya valida `is_platform_admin()` en backend → solo `info@sertuss.com` puede mutar.
- Las políticas RLS de `organization_modules` siguen siendo la única fuente de verdad: el cliente que reciba el broadcast hará un SELECT que pasa por RLS (un owner solo ve su org).
- Realtime respeta RLS en `postgres_changes`; un owner solo recibirá eventos de su propia org.
- No se añaden nuevos grants, funciones ni se relaja el bypass eliminado en el cambio anterior.

## Fuera de alcance
- Bus global de "credits:blocked" estilo eventos custom — innecesario, Realtime ya entrega la señal.
- Cambios al RPC, RLS o tablas.

## Verificación
- Owner conectado en `/escrituras`. SuperAdmin desactiva Escrituras para esa org → sidebar del owner pierde el item y `/escrituras` muestra `Forbidden403` sin reload.
- SuperAdmin sobre su propia org desactiva Cancelaciones → su sidebar se actualiza instantáneamente vía `refreshModules()`.
