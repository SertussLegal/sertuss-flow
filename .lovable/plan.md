

## Plan: Flujo Inteligente Completo — SERTUSS-EXTRACT → Validación → SERTUSS-EDITOR-PRO

Implementación del pipeline de 3 pasos con las 3 garantías solicitadas: sanitización HTML, skeleton de carga, y sincronización inversa persistente.

---

### 1. Instalar DOMPurify para sanitización HTML

**`package.json`** — Agregar `dompurify` + `@types/dompurify`

Se usará en `DocxPreview.tsx` para sanitizar todo HTML antes de inyectarlo con `dangerouslySetInnerHTML`, tanto el HTML de mammoth como el `texto_final_word` que devuelve la IA.

---

### 2. Nuevos tipos — `src/lib/types.ts`

```typescript
export interface SugerenciaIA {
  tipo: "discrepancia" | "estilo";
  texto_original: string;
  texto_sugerido: string;
  mensaje: string;
  campo?: string;
}

export interface ResultadoEditorPro {
  texto_final_word: string;
  sugerencias_ia: SugerenciaIA[];
}
```

---

### 3. Edge function `process-expediente` (orquestador)

**`supabase/functions/process-expediente/index.ts`**

1. Recibe `{ tramite_id }` + JWT del usuario
2. Lee personas, inmueble, actos del trámite via `SUPABASE_SERVICE_ROLE_KEY`
3. Lee `notaria_styles` para la organización del trámite
4. **Validación de roles**: compara personas extraídas (en `metadata.extracted_personas`) con propietarios del certificado → asigna rol vendedor
5. Construye **Súper-JSON** con: vendedores, compradores, inmueble, actos, estilo_notaria
6. Llama internamente a `generate-document` con el Súper-JSON
7. Retorna `{ texto_final_word, sugerencias_ia, templateData }`

---

### 4. Reescribir `generate-document` → SERTUSS-EDITOR-PRO

**`supabase/functions/generate-document/index.ts`**

- Recibe Súper-JSON (incluyendo `estilo_notaria` opcional)
- System prompt enriquecido: incluir estilo de linderos, cláusulas personalizadas, reglas de concordancia de género
- Tool definition ampliada: devuelve `texto_final_word` (HTML completo del documento) + `sugerencias_ia` (array de discrepancias y ajustes de estilo)
- Modelo: `google/gemini-2.5-pro` (para mayor calidad en redacción legal extensa)

---

### 5. DocxPreview — Sanitización + Resaltados + Skeleton

**`src/components/tramites/DocxPreview.tsx`**

**Sanitización (punto 1 del usuario):**
- Importar DOMPurify
- Sanitizar todo HTML antes de `dangerouslySetInnerHTML`: tanto el HTML de mammoth como `texto_final_word`
- Configurar `ALLOWED_TAGS` para permitir `<mark>`, `<span>` con atributos `data-*`, `class`, `style`

**Skeleton de carga (punto 2 del usuario):**
- Nuevo prop `generating?: boolean`
- Cuando `generating=true`, mostrar un skeleton elegante que simula las líneas de un documento legal (bloques animados de diferentes anchos dentro del marco de página)
- Texto debajo: "Redactando documento con IA…" con spinner

**Resaltados de sugerencias:**
- Nuevo prop `sugerenciasIA?: SugerenciaIA[]`
- Después de aplicar variables, buscar cada `texto_original` en el HTML e insertar `<mark>`:
  - Naranja (`background: #fed7aa; border-bottom: 2px solid #f97316`): tipo `"discrepancia"`
  - Azul (`background: #bfdbfe; border-bottom: 2px solid #3b82f6`): tipo `"estilo"`
  - Atributo `data-sugerencia-idx="N"` para identificar al clic

**Popover de sugerencia al clic:**
- Al hacer clic en `<mark data-sugerencia-idx>`, mostrar popover con:
  - Título: "Discrepancia detectada" / "Ajuste de estilo" (según tipo)
  - Mensaje explicativo de la IA
  - Texto sugerido
  - Botones: "Aceptar" (reemplaza texto, dispara `onSugerenciaAccepted`) / "Ignorar" (cierra popover)

**Nuevo callback prop:** `onSugerenciaAccepted?: (idx: number, textoSugerido: string) => void`

---

### 6. Validacion.tsx — Orquestación + Sincronización inversa persistente

**Estado nuevo:**
```typescript
const [sugerenciasIA, setSugerenciasIA] = useState<SugerenciaIA[]>([]);
const [generatingWord, setGeneratingWord] = useState(false);
```

**Flujo de generación (`handleConfirmGenerate`):**
1. `setGeneratingWord(true)` → DocxPreview muestra skeleton
2. Llama a `process-expediente` con `{ tramite_id }`
3. Recibe `{ texto_final_word, sugerencias_ia, templateData }`
4. Guarda `sugerencias_ia` en estado
5. Guarda `texto_final_word` + `sugerencias_ia` en `tramites.metadata`
6. `setGeneratingWord(false)` → DocxPreview renderiza el documento con resaltados

**Sincronización inversa (punto 3 del usuario):**
- `handleSugerenciaAccepted(idx, textoSugerido)`:
  1. Identifica la sugerencia por índice
  2. Si tiene `campo`, usa `handleFieldEdit` para actualizar el formulario → esto dispara el `useEffect` que marca `isDirty=true` → autoguardado en 15s
  3. Si no tiene campo específico, actualiza `texto_final_word` directamente en metadata
  4. Elimina la sugerencia aceptada del array
  5. **Fuerza guardado inmediato** (`handleAutoSave()`) para no depender del debounce de 15s en decisiones del usuario

**Restauración desde metadata:**
- En `loadTramite`: cargar `sugerencias_ia` y `texto_final_word` desde metadata si existen

**Props pasados a DocxPreview:**
```tsx
<DocxPreview
  {...existingProps}
  sugerenciasIA={sugerenciasIA}
  generating={generatingWord}
  onSugerenciaAccepted={handleSugerenciaAccepted}
/>
```

---

### Archivos a crear/modificar

| Archivo | Cambio |
|---------|--------|
| `package.json` | Agregar `dompurify` + `@types/dompurify` |
| `src/lib/types.ts` | Agregar `SugerenciaIA`, `ResultadoEditorPro` |
| `supabase/functions/process-expediente/index.ts` | **Crear**: orquestador (lee DB, Súper-JSON, llama generate-document) |
| `supabase/functions/generate-document/index.ts` | Reescribir: Súper-JSON + estilo, devolver `texto_final_word` + `sugerencias_ia` |
| `src/components/tramites/DocxPreview.tsx` | Sanitización con DOMPurify, skeleton de generación, resaltados `<mark>`, popover de sugerencias |
| `src/pages/Validacion.tsx` | Estado sugerencias, llamar `process-expediente`, sincronización inversa con guardado inmediato, restaurar desde metadata |

