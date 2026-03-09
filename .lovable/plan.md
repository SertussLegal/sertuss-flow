

## Reestructuración de Validación de Escritura — Plan de Implementación

### Punto sobre OCR y modelo multimodal

Lovable AI Gateway ya tiene `LOVABLE_API_KEY` configurada. Para OCR de documentos escaneados (cédulas, certificados de tradición con linderos), usaremos **`google/gemini-2.5-flash`** — soporta entrada multimodal (imágenes) con buena precisión y menor latencia que Pro. No se necesita API key adicional.

---

### Fase 1: DB Migration — Nuevas columnas

```sql
ALTER TABLE personas ADD COLUMN municipio_domicilio text DEFAULT '';
ALTER TABLE personas ADD COLUMN actua_mediante_apoderado boolean DEFAULT false;
ALTER TABLE personas ADD COLUMN apoderado_persona_nombre text DEFAULT '';
ALTER TABLE personas ADD COLUMN apoderado_persona_cedula text DEFAULT '';
ALTER TABLE inmuebles ADD COLUMN avaluo_catastral text DEFAULT '';
ALTER TABLE inmuebles ADD COLUMN escritura_ph text DEFAULT '';
ALTER TABLE inmuebles ADD COLUMN reformas_ph text DEFAULT '';
```

### Fase 2: Tipos (`src/lib/types.ts`)

Agregar a `Persona`: `municipio_domicilio`, `actua_mediante_apoderado`, `apoderado_persona_nombre`, `apoderado_persona_cedula`

Agregar a `Inmueble`: `avaluo_catastral`, `escritura_ph`, `reformas_ph`

Actualizar `createEmptyPersona` y `createEmptyInmueble`.

### Fase 3: Edge Function OCR — `supabase/functions/scan-document/index.ts`

- Recibe `{ image: string (base64), type: "cedula" | "certificado_tradicion" | "predial" }`
- Usa Lovable AI Gateway con **`google/gemini-2.5-flash`** (multimodal)
- Envía la imagen como content part `image_url` con data URI
- Tool calling para extracción estructurada según tipo:
  - `cedula` → `nombre_completo`, `numero_cedula`, `municipio_expedicion`
  - `certificado_tradicion` → `matricula`, `orip`, `linderos`, `propietarios`, `direccion`, `municipio`, `departamento`
  - `predial` → `identificador_predial`, `avaluo_catastral`, `area`
- Manejo de errores 429/402
- `verify_jwt = false` en config.toml

### Fase 4: Formularios actualizados

**`PersonaForm.tsx`:**
- Campo "Municipio de Domicilio"
- Switch "¿Actúa mediante Apoderado?" con campos condicionales (nombre/cédula apoderado persona)
- Botón "Escanear Cédula" → abre file input, convierte a base64, llama `consume_credit` → invoca `scan-document` con type `cedula`, llena campos automáticamente
- Spinner "Procesando con Gemini IA..."

**`InmuebleForm.tsx`:**
- Label "Oficina de Registro (ORIP)" en vez de "Círculo Registral"
- Selector CHIP vs "Cédula Catastral" (renombrar `predial_nacional`)
- Campo "Avalúo Catastral (COP)"
- Sección PH: "Escritura de Constitución PH" y "Reformas PH"
- Botón "Escanear Certificado de Tradición" → misma lógica OCR

**`ActosForm.tsx`:**
- Cambiar input texto por `Select` con opciones: Compraventa, Hipoteca, Afectación a Vivienda Familiar
- Renombrar "Valor Hipoteca" → "Valor de Crédito"
- Campo "Apoderado del Banco" ya existe, mantener

### Fase 5: Split View con Preview en vivo

**Nuevo: `src/components/tramites/DocxPreview.tsx`**
- Recibe `vendedores`, `compradores`, `inmueble`, `actos` como props
- Usa `docxtemplater` + `pizzip` para procesar la plantilla con datos actuales
- Convierte a HTML con `mammoth` (nueva dependencia)
- Debounce 500ms para re-render
- ScrollArea con estilo de documento (fondo blanco, bordes, tipografía serif)

**`Validacion.tsx`:**
- Reemplazar placeholder izquierdo por `<DocxPreview />`
- Usar `ResizablePanelGroup` (ya instalado: `react-resizable-panels`)
- Actualizar `personaToRow` e `inmuebleToRow` con nuevos campos

**`PreviewModal.tsx`:**
- Mostrar nuevos campos (municipio domicilio, avalúo, PH)

### Fase 6: Reglas de negocio

- Cada "Escanear" llama `consume_credit` ANTES de invocar la edge function
- Si créditos = 0, toast "Sin créditos" y no escanea
- Bloqueo de descarga Word si falta NIT/Razón Social (ya implementado)

### Archivos

| Archivo | Acción |
|---------|--------|
| Migration SQL | 7 columnas nuevas |
| `src/lib/types.ts` | Nuevos campos + factories |
| `supabase/functions/scan-document/index.ts` | **Nuevo** — OCR con Gemini 2.5 Flash multimodal |
| `src/components/tramites/PersonaForm.tsx` | Municipio, apoderado, botón escanear |
| `src/components/tramites/InmuebleForm.tsx` | ORIP, avalúo, PH, escanear |
| `src/components/tramites/ActosForm.tsx` | Select tipo acto, renombrar crédito |
| `src/components/tramites/DocxPreview.tsx` | **Nuevo** — visor Word reactivo |
| `src/pages/Validacion.tsx` | Split view, nuevos campos en helpers |
| `src/components/tramites/PreviewModal.tsx` | Mostrar nuevos campos |

### Dependencia nueva
- `mammoth` — conversión docx → HTML para preview en vivo

