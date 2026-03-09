

## Plan: Ajustes rápidos al formulario de trámites

Cambios basados en el feedback del usuario notarial. No se tocan las columnas de la base de datos (siguen existiendo pero se dejan de usar en UI). Esto evita migraciones y mantiene compatibilidad.

---

### Cambios por archivo

**1. `src/components/tramites/InmuebleForm.tsx`**
- Eliminar campo "Estrato" (no aplica en escritura pública)
- Eliminar campo "Valorización" (confuso; el dato relevante es avalúo catastral que ya existe)
- Cambiar label de cédula catastral: `(Número predial)` a `(Cédula catastral)`
- Cambiar placeholder de cédula catastral: `"Número predial"` a `"Cédula catastral"`
- Cambiar placeholder de ORIP: `"Nombre o código de la ORIP"` a `"Ej: Oficina de Registro de Instrumentos Públicos de Bogotá Zona Norte"`
- Hacer sección PH condicional con un Switch `"¿Cuenta con Reglamento de Propiedad Horizontal?"`. Solo mostrar campos de escritura PH y reformas si está activo. Agregar campo booleano `es_propiedad_horizontal` al tipo Inmueble.

**2. `src/components/tramites/ActosForm.tsx`**
- Eliminar sección "Afectación a Vivienda Familiar" (se resuelve en sala con las partes)
- Actualizar opciones de tipo de acto: dejar solo "Compraventa" y "Compraventa con Hipoteca" (el toggle de hipoteca se activa automáticamente al seleccionar "Compraventa con Hipoteca")

**3. `src/components/tramites/PersonaForm.tsx`**
- Agregar campo "Municipio de Domicilio del Apoderado" cuando `actua_mediante_apoderado` es true
- Agregar campo para municipio de domicilio del apoderado en la interfaz Persona

**4. `src/lib/types.ts`**
- Agregar `es_propiedad_horizontal: boolean` a interface `Inmueble`
- Agregar `apoderado_persona_municipio: string` a interface `Persona`
- Actualizar `createEmptyInmueble` con `es_propiedad_horizontal: false`
- Actualizar `createEmptyPersona` con `apoderado_persona_municipio: ""`
- No eliminar campos existentes del type (mantener compatibilidad con DB)

**5. `src/components/tramites/PreviewModal.tsx`**
- Quitar línea de Estrato del preview
- Quitar línea de Valorización del preview
- Quitar badge de Afectación Vivienda Familiar
- Mostrar PH solo si `es_propiedad_horizontal`
- Mostrar municipio de domicilio del apoderado

**6. `src/pages/Validacion.tsx`**
- Actualizar `inmuebleToRow` para incluir `es_propiedad_horizontal` (si no lo incluye aún, se envía pero la columna DB puede no existir, se ignora silenciosamente)
- Actualizar `personaToRow` para incluir `apoderado_persona_municipio`

**7. Migración DB** (opcional, ligera)
- `ALTER TABLE inmuebles ADD COLUMN es_propiedad_horizontal boolean DEFAULT false;`
- `ALTER TABLE personas ADD COLUMN apoderado_persona_municipio text DEFAULT '';`

---

### Resumen de lo que se elimina de la UI (no de la DB)
- Campo Estrato
- Campo Valorización  
- Sección Afectación a Vivienda Familiar
- Opción "Hipoteca" y "Afectación a Vivienda Familiar" como tipos de acto sueltos

### Resumen de lo que se agrega
- Toggle condicional para PH en inmueble
- Municipio de domicilio del apoderado en persona
- Auto-activación de hipoteca al seleccionar "Compraventa con Hipoteca"
- Labels y placeholders corregidos para cédula catastral y ORIP

