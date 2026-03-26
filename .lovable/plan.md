

## Plan: UI para configurar estilos de notaría

### Contexto
La tabla `notaria_styles` ya existe (1:1 con `organizations`), y `process-expediente` ya la consume. Falta la interfaz para que el owner/admin configure los datos.

### Cambios

| Archivo | Cambio |
|---------|--------|
| `src/pages/NotariaSettings.tsx` | **Crear**: Página con formulario para nombre_notaria, ciudad, notario_titular, estilo_linderos (select: estándar/técnico/narrativo), y textarea para cláusulas personalizadas (JSONB). Carga datos existentes vía SELECT, upsert on save. Solo accesible para owner/admin. |
| `src/App.tsx` | Agregar ruta `/notaria` → `NotariaSettings` protegida |
| `src/pages/Dashboard.tsx` | Agregar botón "Configuración Notaría" (ícono Settings) en el header, visible solo para owner/admin, navega a `/notaria` |

### Formulario (`NotariaSettings.tsx`)
- **Nombre de la Notaría** (text input, requerido)
- **Ciudad** (text input, requerido)
- **Notario Titular** (text input, requerido)
- **Estilo de Linderos** (select: "Estándar — puntos cardinales", "Técnico — coordenadas y medidas", "Narrativo — descripción literaria")
- **Cláusulas Personalizadas** (textarea JSON, opcional, con validación de formato)
- Botón "Guardar" → upsert en `notaria_styles` con `organization_id` del perfil
- Toast de confirmación al guardar

### Lógica
- On mount: `SELECT * FROM notaria_styles WHERE organization_id = profile.organization_id`
- On save: Si existe registro → UPDATE, si no → INSERT (upsert via `.upsert()`)
- RLS ya permite owner/admin para ALL, y SELECT para cualquier miembro de la org

