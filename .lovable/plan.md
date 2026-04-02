

## Plan: Cambiar `.single()` → `.maybeSingle()` en consultas que pueden no tener registros

### Revisión holística

Revisé **todos** los usos de `.single()` en el proyecto (70 coincidencias en 5 archivos). Los clasifico:

**Correctos con `.single()` — NO cambiar:**
- `tramites.select("*").eq("id", tid).single()` (línea 150): El trámite DEBE existir, si no, hacemos `return`. Correcto.
- `AuthContext.tsx`: Consultas a `profiles` y `organizations` por ID de usuario autenticado — siempre existe exactamente 1 registro. Correcto.
- `DocumentUploadStep.tsx` (línea 328): Es un INSERT con `.select().single()` — retorna el registro recién creado. Correcto.
- `Validacion.tsx` línea 528: INSERT con `.select().single()` — mismo caso. Correcto.
- `process-expediente/index.ts`: Edge function que procesa un trámite que ya existe con todos sus datos. Correcto (falla intencionalmente si no hay datos).
- `validar-con-claude/index.ts`: Busca configuración/plantilla que debe existir. Correcto.

**Deben cambiar a `.maybeSingle()` — 2 líneas:**
- Línea 188: `inmuebles.select("*").eq("tramite_id", tid).single()` — en trámites nuevos, el inmueble aún no se ha guardado en BD. Causa error 406.
- Línea 189: `actos.select("*").eq("tramite_id", tid).single()` — mismo caso, los actos no existen hasta que el usuario guarde.

Ambas líneas ya tienen fallback correcto:
- Línea 230: `if (inm) setInmueble(...)` else usa `extracted_inmueble`
- Línea 241: `if (act) setActos(...)`

El cambio es mínimo, quirúrgico y **no rompe ningún otro flujo**. Es exactamente lo que se necesita.

### Cambio

| Archivo | Línea | Cambio |
|---|---|---|
| `src/pages/Validacion.tsx` | 188 | `.single()` → `.maybeSingle()` |
| `src/pages/Validacion.tsx` | 189 | `.single()` → `.maybeSingle()` |

2 líneas en 1 archivo. Sin efectos secundarios.

