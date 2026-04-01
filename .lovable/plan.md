

## Plan: Crear 4 tablas de validación con Claude API

### Problemas detectados en el SQL proporcionado

Antes de ejecutar la migración, hay **4 incompatibilidades** con tu esquema actual que debo resolver:

1. **`notarias(id)` no existe** — Tu app usa `organizations` como entidad de notaría. La FK en `configuracion_notaria` debe apuntar a `organizations(id)`.

2. **`usuarios_notaria` no existe** — Las políticas RLS que filtran por notaría deben usar `get_user_org(auth.uid())` (tu patrón existente) en lugar de una tabla inexistente.

3. **CHECK constraints** — Según las mejores prácticas del proyecto, las validaciones como `categoria IN (...)` deben implementarse como **triggers de validación** en lugar de CHECK constraints para evitar problemas de restauración.

4. **Política INSERT con USING** — `"Service role inserta historial"` usa `USING` pero INSERT requiere `WITH CHECK`.

### Cambios que haré al SQL

| Original | Ajuste |
|---|---|
| `REFERENCES notarias(id)` | `REFERENCES organizations(id)` |
| `notaria_id IN (SELECT ... FROM usuarios_notaria)` | `notaria_id = get_user_org(auth.uid())` o aislamiento por `organization_id` |
| CHECK constraints en `categoria`, `nivel_severidad`, `momento`, `tipo_notario` | Triggers de validación |
| `USING (true)` en INSERT | `WITH CHECK (true)` |
| `historial_validaciones.notaria_id` | Renombrar a `organization_id` para consistencia con el resto del schema |

### Migración resultante

Se creará **1 migración SQL** con:

- 4 tablas nuevas con RLS habilitado
- Índices según tu especificación
- Triggers de validación en lugar de CHECK constraints
- Políticas RLS adaptadas al patrón `get_user_org(auth.uid())` existente
- Política adicional para que edge functions (service_role) puedan insertar historial

### Tablas existentes

No se modifica ninguna tabla existente.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| Nueva migración SQL | Crear las 4 tablas con ajustes de compatibilidad |

Solo 1 migración, 0 archivos de código.

