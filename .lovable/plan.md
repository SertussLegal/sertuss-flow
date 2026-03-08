

## Fix: Dashboard no actualiza datos legales después de cambios en Admin

### Problema

El `AuthContext` carga los datos de la organización una sola vez al iniciar sesión. Cuando el admin actualiza el NIT desde `/admin/entidad/:id`, el estado `organization` en memoria sigue teniendo `nit: null`, por lo que el Dashboard sigue mostrando la advertencia.

### Solución

Llamar `refreshProfile()` en el `useEffect` del Dashboard al montar el componente. Esto re-consulta la organización desde la base de datos y actualiza el estado con los datos más recientes (incluyendo el NIT recién agregado).

### Cambio

| Archivo | Cambio |
|---------|--------|
| `src/pages/Dashboard.tsx` | Agregar `refreshProfile()` al `useEffect` de montaje, junto al fetch de trámites |

El `useEffect` existente que llama `fetchTramites()` cuando `profile?.organization_id` cambia, también llamará `refreshProfile()` para asegurar que `organization` esté actualizado.

