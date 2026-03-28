

## Plan: Refactorizar captura de documentos — Flujo Proactivo con Confianza

### Resumen

Mover la carga de documentos al inicio del flujo, alinear las llaves del JSON de la IA con los tags de la plantilla Word, agregar lógica de inferencia legal por tipo de acto, implementar condicionales en docxtemplater, y resaltar campos de baja confianza en ámbar.

### Nuevas tablas (migración SQL)

**`config_tramites`** — Define campos obligatorios por tipo de acto (Ley 1579):
```sql
CREATE TABLE public.config_tramites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_acto text NOT NULL UNIQUE,
  campos_obligatorios jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

-- Seed para Compraventa
INSERT INTO public.config_tramites (tipo_acto, campos_obligatorios) VALUES
('Compraventa', '["matricula_inmobiliaria","identificador_predial","linderos","avaluo_catastral"]');
```

**`logs_extraccion`** — Almacena lo que la IA leyó vs lo que el usuario corrigió:
```sql
CREATE TABLE public.logs_extraccion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tramite_id uuid REFERENCES public.tramites(id) ON DELETE CASCADE NOT NULL,
  data_ia jsonb NOT NULL,
  data_final jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.logs_extraccion ENABLE ROW LEVEL SECURITY;
-- RLS: misma org
```

### Cambios en Edge Functions

**1. `scan-document/index.ts` — Alinear llaves + confianza**

- Renombrar llaves del tool schema para que coincidan con tags de la plantilla Word:
  - `nupre` → no cambia (ya es correcto)
  - Agregar `confianza` (enum: "alta" | "media" | "baja") a cada campo extraído
- Agregar campo `confianza` en cada propiedad del JSON Schema como propiedad hermana o como wrapper:
  ```
  matricula_inmobiliaria: { valor: "50C-1817286", confianza: "alta" }
  ```
- Para `certificado_tradicion`: si el tipo de acto es "Compraventa", el prompt debe exigir:
  - `matricula_inmobiliaria` (obligatorio)
  - `identificador_predial` (30 dígitos, cédula catastral)
  - `linderos` (transcripción literal)
  - Si `es_propiedad_horizontal: true` → buscar escritura PH y reformas
- Agregar instrucción al system prompt: "Si no estás seguro de un dato, marca `confianza: 'baja'`"

**2. `process-expediente/index.ts` — Consultar config_tramites**

- Antes de construir el Súper-JSON, consultar `config_tramites` para obtener `campos_obligatorios` del tipo de acto
- Incluir esa lista en el prompt del EDITOR-PRO para que valide completitud
- Al finalizar: insertar `logs_extraccion` con `data_ia` = resultado crudo de la extracción

### Cambios en Frontend

**3. Nuevo componente: `src/components/tramites/DocumentUploadStep.tsx`**

Paso inicial del flujo "Nuevo Trámite". UI tipo wizard:
- Dropzone para subir documentos (cédulas, certificados, predial)
- Cada documento se envía a `scan-document` inmediatamente
- Skeleton/progress por documento
- Al terminar todos, navega a Validación con datos pre-poblados
- Campos con `confianza: "baja"` se marcan con badge ámbar

**4. `src/pages/Validacion.tsx`**

- Nuevo estado: `confianzaFields: Map<string, "alta"|"media"|"baja">`
- Al recibir datos de extracción, parsear el wrapper `{ valor, confianza }` → poblar formulario + registrar confianza
- Campos con confianza "baja" tienen borde ámbar + tooltip "Verificación requerida"
- Bloquear botón "Generar documento" si hay campos obligatorios con confianza "baja" sin editar
- Al guardar: comparar `data_ia` vs datos editados → UPDATE `logs_extraccion.data_final`

**5. `src/components/tramites/DocxPreview.tsx`**

- docxtemplater ya está configurado con `paragraphLoop: true`
- Agregar `nullGetter` que devuelva `undefined` (no `"___________"`) para que `{#campo}...{/campo}` elimine párrafos cuando el campo es null/vacío
- Resaltar en ámbar los spans de campos con confianza baja en el preview

**6. `src/components/tramites/InmuebleForm.tsx` y `PersonaForm.tsx`**

- Recibir prop `confianzaFields` → renderizar borde ámbar + ícono de advertencia en campos de baja confianza
- Al editar un campo marcado como "baja", cambiar confianza a "alta" automáticamente

### Flujo completo

```text
Dashboard → [+ Nuevo Trámite]
  ↓
DocumentUploadStep (nuevo)
  - Subir cédulas, certificados, predial
  - Cada doc → scan-document (con confianza)
  ↓
Validación (existente, pre-poblada)
  - Campos ámbar = confianza baja
  - Usuario valida/corrige
  - logs_extraccion guarda data_ia vs data_final
  ↓
Generar Escritura (existente)
  - docxtemplater con {#campo}...{/campo}
  - Campos null → párrafos eliminados
```

### Archivos a crear/modificar

| Archivo | Cambio |
|---------|--------|
| Migración SQL | Crear `config_tramites` + `logs_extraccion` + RLS + seed |
| `supabase/functions/scan-document/index.ts` | Agregar `confianza` al schema, lógica de campos obligatorios por tipo de acto, instrucciones PH |
| `supabase/functions/process-expediente/index.ts` | Consultar `config_tramites`, insertar `logs_extraccion` |
| `src/components/tramites/DocumentUploadStep.tsx` | **Crear**: wizard de carga anticipada |
| `src/pages/Validacion.tsx` | Estado de confianza, bloqueo de generación, logging de correcciones |
| `src/components/tramites/DocxPreview.tsx` | nullGetter para condicionales, resaltado ámbar |
| `src/components/tramites/InmuebleForm.tsx` | Props de confianza, borde ámbar |
| `src/components/tramites/PersonaForm.tsx` | Props de confianza, borde ámbar |
| `src/lib/types.ts` | Interfaz `ConfianzaField`, tipo `LogExtraccion` |
| `src/App.tsx` | Ruta `/nuevo-tramite` → DocumentUploadStep |

