

## Plan: Crear edge function `validar-con-claude` + botón de prueba en Admin

### 1. Crear `supabase/functions/validar-con-claude/index.ts`

Se usará el código proporcionado con estos ajustes:

| Original | Ajuste |
|---|---|
| `notaria_id` en el payload/interfaz | `organization_id` |
| `notaria_id` en query a `configuracion_notaria` | `.eq("organization_id", payload.organization_id)` |
| `notaria_id` en insert a `historial_validaciones` | `organization_id: payload.organization_id` |
| CORS headers | Ampliar para incluir headers de Supabase SDK (`x-supabase-client-platform`, etc.) como en las otras funciones |
| `error.message` en catch | `error instanceof Error ? error.message : "Unknown error"` (type safety) |

La lógica, prompts y funciones auxiliares se mantienen exactamente como los proporcionaste.

### 2. Agregar config en `supabase/config.toml`

```toml
[functions.validar-con-claude]
verify_jwt = false
```

### 3. Botón temporal de prueba en `src/pages/Admin.tsx`

Se agregará debajo de las stats cards:
- Un botón "Probar Validación Claude" visible solo para `role === "owner"`
- Al hacer clic, envía datos de prueba (un vendedor y un inmueble ficticios, tipo_acto `compraventa`, modo `campos`)
- Muestra la respuesta en un Dialog con el JSON formateado
- Muestra estados de carga y errores

### Archivos a crear/modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/validar-con-claude/index.ts` | Crear con código ajustado |
| `supabase/config.toml` | Agregar bloque de la función |
| `src/pages/Admin.tsx` | Agregar botón temporal + dialog de respuesta |

3 archivos.

