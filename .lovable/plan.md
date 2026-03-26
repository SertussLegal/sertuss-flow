

## Plan: Hacer NotariaSettings amigable para abogados

### Cambios en `src/pages/NotariaSettings.tsx`

**1. Agregar textos de ayuda (helper text) debajo de cada campo** explicando para qué sirve y cómo se refleja en el documento:

- **Nombre de la Notaría**: helper: *"Aparecerá en el encabezado de cada escritura: 'En la ciudad de Bogotá, ante la Notaría 32...'"*
- **Ciudad**: helper: *"Se usará en la comparecencia: 'En la ciudad de [Ciudad]...'"*
- **Notario Titular**: helper: *"Firmará como: 'Ante mí, [Notario Titular], Notario...' al cierre del documento"*
- **Estilo de Linderos**: helper con ejemplo dinámico según la opción seleccionada:
  - Estándar: *"Ejemplo: 'Por el NORTE, con la calle 80; por el SUR, con el lote 5...'"*
  - Técnico: *"Ejemplo: 'Del punto 1 al punto 2: N 45°30' E, 12.50 m...'"*
  - Narrativo: *"Ejemplo: 'El predio limita al costado norte con la vía principal que conduce...'"*

**2. Reemplazar textarea JSON por formulario dinámico de cláusulas:**

- Cambiar estado `clausulasRaw` (string) por `clausulas: { nombre: string; texto: string }[]`
- Cada cláusula se muestra como: Input (nombre) + Textarea (texto) + botón Eliminar
- Botón "+ Agregar cláusula" al final
- Al cargar: `Object.entries(data) → [{ nombre, texto }]`
- Al guardar: `Object.fromEntries(clausulas.map(c => [c.nombre, c.texto]))`
- Helper: *"Estas cláusulas se insertarán automáticamente en las escrituras. Ej: una cláusula de paz y salvo específica de su notaría."*
- Eliminar toda referencia a "JSON"

**3. Agregar un bloque visual de "Vista previa" (texto informativo):**

Un recuadro con fondo suave debajo del título que muestre cómo quedaría el encabezado del documento con los datos actuales:

> *En la ciudad de **Bogotá D.C.**, ante la **Notaría 32 de Bogotá D.C.**, compareció... Ante mí, **Dr. Juan Pérez García**, Notario...*

Este texto se actualiza en tiempo real conforme el usuario escribe.

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/NotariaSettings.tsx` | Agregar helpers, vista previa dinámica, reemplazar textarea JSON por formulario de cláusulas |

Un solo archivo, sin cambios de backend.

