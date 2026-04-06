

## Plan: Directorio de Notarías Multitenant con Geometría de Página

### Contexto

Actualmente `notaria_styles` es 1:1 con organización (un solo registro). El usuario es un abogado que trabaja con múltiples notarías, cada una con identidad física, márgenes de papel sellado y preferencias de redacción distintas. El refactor convierte esto en un directorio 1:N.

### Fase 1: Directorio + Geometría de Página

**Migración DB**
- Quitar constraint unique de `notaria_styles.organization_id`
- Agregar columnas de geometría: `margin_top_mm` (default 30), `margin_bottom_mm` (default 25), `margin_left_mm` (default 35), `margin_right_mm` (default 25), `line_height_pt` (default 18), `lineas_por_pagina` (default 30)
- Agregar columnas de preferencias de redacción: `precios_mayusculas` (boolean, default true), `formato_fecha` (text, default 'notarial'), `linderos_formato` (text, default 'bloque')
- Agregar `tramites.notaria_style_id uuid` (nullable, FK a `notaria_styles.id`)

**`NotariaSettings.tsx` → Directorio**
- Vista de lista con cards de todas las notarías de la organización
- Cada card muestra: nombre, ciudad, notario titular, badge con conteo de trámites asociados
- Botón "Agregar Notaría" abre un Dialog con el formulario completo:
  - Sección 1: Identidad (nombre, ciudad, notario)
  - Sección 2: Geometría de Página (márgenes en mm, interlineado, líneas por página) con presets: "Estándar 30 líneas", "Compacto 35 líneas", "Personalizado"
  - Sección 3: Preferencias de Redacción (estilo linderos, precios en mayúsculas, formato fecha)
  - Sección 4: Cláusulas personalizadas (existente)
- Editar y eliminar por notaría

**`DocumentUploadStep.tsx` → Selector de Notaría**
- Al inicio del paso 1, antes de los documentos: combo/autocomplete "¿En qué notaría se otorgará?"
- Lista las notarías guardadas de la organización
- Opción "+ Nueva notaría" abre modal de Configuración Rápida (solo nombre, ciudad, notario + preset de márgenes)
- Al continuar, persiste `notaria_style_id` en el trámite

**`Validacion.tsx`**
- `loadTramite` carga la notaría vía `notaria_style_id` del trámite
- Pasa datos de geometría y preferencias a `DocxPreview`
- Alerta de discrepancia: si la escritura antecedente menciona una notaría diferente a la seleccionada, muestra banner amarillo: "El título viene de la Notaría X, pero estás redactando para la Notaría Y"

**`DocxPreview.tsx`**
- Recibe props de geometría (`margins`, `lineHeight`) y aplica estilos CSS inline al contenedor del preview
- Respeta `precios_mayusculas` al renderizar montos
- Respeta `formato_fecha` al renderizar fechas
- Respeta `linderos_formato` al renderizar linderos

**`process-expediente/index.ts`**
- Busca `notaria_styles` por `notaria_style_id` del trámite (fallback: primera de la org)

### Fase 2: Redacción Dinámica (posterior, no se implementa ahora)

- Jerarquía de estilos: Estilo de Notaría (base) + Override del Abogado (por trámite)
- Templates de redacción por tipo de acto vinculados a notaría
- Historial de preferencias por notaría (aprendizaje)

### Resumen de archivos

| Archivo | Cambio |
|---|---|
| Migración DB | Geometría + preferencias + `notaria_style_id` en tramites |
| `NotariaSettings.tsx` | Directorio CRUD con cards + formulario con geometría |
| `DocumentUploadStep.tsx` | Selector/autocomplete de notaría destino |
| `Validacion.tsx` | Cargar notaría por trámite, alerta de discrepancia |
| `DocxPreview.tsx` | Aplicar márgenes y preferencias de redacción dinámicamente |
| `process-expediente/index.ts` | Buscar notaría por `notaria_style_id` |
| `Dashboard.tsx` | Renombrar "Notaría" → "Notarías" |

7 archivos + 1 migración DB. Fase 1 solamente.

