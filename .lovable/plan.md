

## Generate Word Document with Gemini AI

### Architecture

```text
Frontend (Validacion.tsx)
  ├─ 1. consume_credit RPC ──→ Supabase (validate balance)
  ├─ 2. invoke edge function ──→ "generate-document" edge function
  │     ├─ Calls Lovable AI Gateway (Gemini) with form data
  │     └─ Returns structured legal content as JSON
  ├─ 3. docxtemplater + pizzip ──→ Fill template_venta_hipoteca.docx
  ├─ 4. Trigger browser download
  └─ 5. Update tramite status to 'word_generado' ──→ triggers activity log
```

### Changes

**1. Edge Function: `supabase/functions/generate-document/index.ts`**
- Receives vendedores, compradores, inmueble, actos as JSON body
- Calls Lovable AI Gateway (`LOVABLE_API_KEY`) with a detailed legal prompt
- Uses tool calling to extract structured output (all template placeholders)
- Returns JSON with filled template variables (nombres, valores en letras, cláusulas hipotecarias, etc.)

**2. Template: Move `template_venta_hipoteca.docx` to `public/`**
- So the frontend can fetch it at runtime for docxtemplater

**3. Install npm packages: `docxtemplater`, `pizzip`**

**4. Frontend: `src/pages/Validacion.tsx` — rewrite `handleConfirmGenerate`**
- Step 1: `consume_credit` RPC — stop if fails
- Step 2: Call edge function via `supabase.functions.invoke('generate-document', { body: formData })`
- Step 3: Fetch template from `/template_venta_hipoteca.docx`, load with PizZip, fill with docxtemplater using AI response
- Step 4: Generate blob, create download link, trigger click
- Step 5: Update tramite status to `word_generado` — this fires the existing `log_word_generated` trigger
- Step 6: Refresh credits, close modal, show success toast

**5. `supabase/config.toml`** — add function config with `verify_jwt = false`

### Edge Function Prompt Strategy
The system prompt instructs Gemini to return structured data matching the .docx template placeholders. Uses tool calling for reliable JSON extraction. The prompt includes Colombian notarial legal context (Ley 1579 de 2012, escritura pública format).

### Files to create/modify
| File | Action |
|------|--------|
| `supabase/functions/generate-document/index.ts` | Create — edge function with Gemini call |
| `supabase/config.toml` | Add function config |
| `public/template_venta_hipoteca.docx` | Move template here |
| `src/pages/Validacion.tsx` | Rewrite handleConfirmGenerate |
| `package.json` | Add docxtemplater + pizzip |

