

## Plan: Insertar datos semilla en reglas_validacion y plantillas_validacion

### Contexto
Las tablas están vacías y listas para recibir los registros. Son 2 tablas:
- `reglas_validacion`: 22 registros (7 formato, 7 coherencia, 6 legales, 6 negocio)
- `plantillas_validacion`: 3 registros (compraventa, hipoteca, poder)

### Implementación

Se usará la herramienta de inserción de datos (no migración) para ejecutar los INSERT exactos que proporcionaste, sin modificar estructura de tablas.

**Paso 1** — Insertar las 22 reglas de validación en `reglas_validacion` (4 bloques: formato, coherencia, legal, negocio)

**Paso 2** — Insertar las 3 plantillas en `plantillas_validacion` (compraventa, hipoteca, poder)

**Paso 3** — Verificar con SELECT que los conteos sean correctos (22 reglas, 3 plantillas)

### Archivos a modificar
Ninguno. Solo operaciones de datos en la base de datos.

