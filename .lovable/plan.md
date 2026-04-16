

## Plan: Insertar 7 nuevas reglas de validación

Insertar 7 reglas nuevas en `reglas_validacion` sin tocar las existentes. Como es una operación de datos (INSERT), uso la herramienta de migración de datos de Supabase.

### Reglas a insertar

| Código | Categoría | Severidad | Momento |
|---|---|---|---|
| `COH_TEMPLATE_VS_ESCRITURA_PREVIA` | coherencia | advertencia | campos |
| `COH_CADENA_TRADICION` | coherencia | advertencia | campos |
| `COH_INMUEBLE_ENTRE_DOCS` | coherencia | error | campos |
| `COH_VENDEDOR_ES_PROPIETARIO` | coherencia | advertencia | campos |
| `COH_ENTIDAD_BANCARIA_DOCS` | coherencia | error | campos |
| `CTX_DATOS_FALTANTES_POST_CARGA` | negocio | sugerencia | campos |
| `CTX_TEMPLATE_NOTARIA_INFO` | negocio | sugerencia | campos |

### Validaciones previas

- El trigger `validate_reglas_validacion` exige `categoria` ∈ {formato, coherencia, legal, negocio} y `nivel_severidad` ∈ {error, advertencia, sugerencia}. Las 7 reglas cumplen.
- `activa` queda en `true` por defecto, así que las edge functions (`validar-con-claude`) las leerán automáticamente en la próxima invocación.
- No requiere cambios de código — la edge function ya construye el prompt dinámico desde esta tabla.

### Operación

Ejecutar el `INSERT` con los 7 registros vía la herramienta de inserción de datos de Supabase.

### Riesgos

Cero. Es solo agregar filas. Si algo sale mal en una regla nueva, basta con marcar `activa = false` en esa fila.

