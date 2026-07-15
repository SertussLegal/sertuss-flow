
# Plan — UX del modal "Personalizar prosa del Apoderado — Davivienda"

## Diagnóstico

### A. `ZodError.message` es JSON crudo
En `ProsaApoderadoModal.tsx` (líneas ~91–113), `handleSave` hace `OverrideSchema.parse(...)` dentro de un `try/catch` genérico y muestra `err.message` con `toast.error`. `ZodError` serializa su `.message` como el string JSON de `error.issues`, por eso el toast enseña el array crudo.

### B. `adaptar-estilo-prosa` **no acepta texto plano hoy**
Verificado en `supabase/functions/adaptar-estilo-prosa/index.ts`:
- Línea 83: `if (!fileBase64) return json({ error: "fileBase64 requerido" }, 400);` — obliga a archivo.
- Línea 30: `"text/plain"` está en `ALLOWED_MIME`, así que técnicamente se puede base64-encodear el texto pegado y mandarlo como `text/plain`. Funcionaría sin cambios de edge.
- Pero el `SYSTEM_PROMPT` (líneas 36–52) dice explícitamente "El usuario adjuntará un documento de REFERENCIA de estilo" y el user turn dice "Analiza el documento adjunto" (línea 97). Con un párrafo corto pegado, el prompt queda incoherente.
- Además el flujo `type: "file"` multimodal es innecesariamente costoso para 500–2000 chars de texto.

**Decisión:** agregar una rama `rawText` a la edge que use un user turn distinto ("Analiza el siguiente texto de REFERENCIA") y saltee la parte multimodal. Cambio mínimo, sin romper el contrato actual.

### C. Cómo distinguir la causa del `ZodError`
Los mensajes vienen del `.refine` en `overrideSchema.ts:50–57`, cuyo `message` es el `reason` que devuelve `isOverrideForbidden`. Los prefijos son estables y ya únicos:
- `"No se pueden redefinir marcadores canónicos:"` → marcador canónico (caso a rescatar).
- `"Contiene token prohibido:"` → token sucio (`___`, `null`, `N/A`, `ilegible`...).
- `"Máximo 2000 caracteres..."` → largo excedido.

Para no dispersar strings mágicas en el componente, expongo un helper `classifyOverrideError(err: unknown)` en `overrideSchema.ts` que devuelve `"canonical_marker" | "forbidden_token" | "too_long" | "other"` + el `message` del primer issue.

## Cambios

### 1. `supabase/functions/_shared/isomorphic/prosaBancos/overrideSchema.ts`

Agregar al final del archivo:

```ts
import { ZodError } from "zod";

export type OverrideErrorKind =
  | "canonical_marker"
  | "forbidden_token"
  | "too_long"
  | "other";

export interface OverrideErrorInfo {
  kind: OverrideErrorKind;
  message: string;
  path: (string | number)[];
}

/**
 * Clasifica un error del schema para que la UI pueda decidir cómo reaccionar
 * (por ejemplo, ofrecer redirigir el texto pegado a `adaptar-estilo-prosa`
 * cuando el usuario metió un marcador canónico en las notas).
 */
export function classifyOverrideError(err: unknown): OverrideErrorInfo | null {
  if (!(err instanceof ZodError)) return null;
  const issue = err.issues[0];
  if (!issue) return null;
  const msg = issue.message ?? "";
  let kind: OverrideErrorKind = "other";
  if (msg.startsWith("No se pueden redefinir marcadores canónicos")) kind = "canonical_marker";
  else if (msg.startsWith("Contiene token prohibido")) kind = "forbidden_token";
  else if (msg.startsWith("Máximo 2000 caracteres")) kind = "too_long";
  return { kind, message: msg, path: [...issue.path] };
}
```

Rationale: vive en el schema isomórfico, no en el componente → cualquier futuro banco/edge que consuma el mismo schema hereda el mismo clasificador.

### 2. `supabase/functions/adaptar-estilo-prosa/index.ts`

Agregar rama `rawText` sin romper `fileBase64`:

```ts
interface Payload {
  fileBase64?: string;
  mimeType?: string;
  fileName?: string;
  rawText?: string;        // NUEVO
  baseContext?: unknown;
}

// ...dentro del handler, reemplazar el guard actual:
const { fileBase64, mimeType, fileName, rawText } = body;
const hasFile = typeof fileBase64 === "string" && fileBase64.length > 0;
const hasText = typeof rawText === "string" && rawText.trim().length > 0;
if (!hasFile && !hasText) {
  return json({ error: "fileBase64 o rawText requerido" }, 400);
}
if (hasFile && (!mimeType || !ALLOWED_MIME.includes(mimeType))) {
  return json({ error: `MIME no soportado: ${mimeType}` }, 400);
}
if (hasText && rawText!.length > 8000) {
  return json({ error: "rawText excede 8000 caracteres" }, 400);
}
if (hasFile) {
  const approxBytes = Math.floor((fileBase64!.length * 3) / 4);
  if (approxBytes > MAX_BYTES) return json({ error: "Archivo excede 8 MB" }, 400);
}

// Construcción de userContent:
let userContent: unknown[];
if (hasText) {
  userContent = [{
    type: "text",
    text:
      `Analiza el siguiente TEXTO DE REFERENCIA (fragmento pegado por el usuario, no un documento completo). ` +
      `Extrae únicamente ESTILO y FRASES GENÉRICAS reutilizables. No copies datos concretos, nombres ni cifras.\n\n---\n${rawText}\n---`,
  }];
} else {
  // ...rama actual (imagen o file), sin cambios
}
```

Todo lo demás (sanitización con `OverrideSchema`, `notas_sugeridas` de vuelta) queda igual. La sanitización final ya te protege si Gemini reemite un marcador canónico.

### 3. `src/components/cancelaciones/prosa/ProsaApoderadoModal.tsx`

**3a. `handleSave` — toast legible + estado de rescate**

Nuevo state en el componente:
```ts
const [rescueText, setRescueText] = useState<string | null>(null);
```

Reemplazar `handleSave` (líneas 91–113):

```ts
const handleSave = async () => {
  try {
    const parsed = OverrideSchema.parse(previewOverride);
    setSaving(true);
    // ...resto igual...
  } catch (err) {
    const info = classifyOverrideError(err);
    if (info?.kind === "canonical_marker") {
      // Guardamos el texto tal cual pegado para que el botón lo mande a la edge.
      setRescueText(notas);
      toast.error("Ese texto contiene estructura canónica del banco. Úsalo como referencia de estilo.");
      return;
    }
    const msg = info?.message ?? (err instanceof Error ? err.message : "Error al guardar");
    toast.error(msg);
  } finally {
    setSaving(false);
  }
};
```

Cuando `notas` cambia manualmente, limpiar el estado de rescate:
```ts
onChange={(e) => { setNotas(e.target.value.slice(0, MAX_NOTAS)); setRescueText(null); }}
```

**3b. Botón "Usar como referencia de estilo" — nuevo handler**

```ts
const handleRescueAsReference = async () => {
  if (!rescueText?.trim()) return;
  setAiLoading(true);
  try {
    const { data, error } = await supabase.functions.invoke("adaptar-estilo-prosa", {
      body: { rawText: rescueText, baseContext },
    });
    if (error) throw error;
    const notasSug = (data as { notas_sugeridas?: string; warning?: string })?.notas_sugeridas ?? "";
    if (!notasSug.trim()) {
      toast.info("La IA no extrajo notas reutilizables del texto");
      return;
    }
    setNotas(notasSug.slice(0, MAX_NOTAS));
    setRescueText(null);
    toast.success("Estilo aplicado — revísalo antes de guardar");
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Error de IA");
  } finally {
    setAiLoading(false);
  }
};
```

UI: banda inline debajo del Textarea (solo cuando `rescueText` existe):
```tsx
{rescueText && (
  <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 flex items-start gap-2">
    <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
    <div className="flex-1 space-y-1.5">
      <p className="text-[11px] leading-snug">
        Detectamos estructura canónica ("COMPARECIÓ:", "PRIMERO.-", etc.) en tu nota.
        Estos marcadores están reservados. ¿Quieres que la IA extraiga solo el
        <span className="font-semibold"> estilo </span>
        del texto pegado y proponga una nota corta compatible?
      </p>
      <Button
        type="button" size="sm" variant="outline" disabled={aiLoading}
        onClick={handleRescueAsReference} className="gap-1.5 text-xs h-7"
      >
        {aiLoading
          ? <><Loader2 className="h-3 w-3 animate-spin" />Procesando...</>
          : <><Sparkles className="h-3 w-3" />Usar como referencia de estilo</>}
      </Button>
    </div>
  </div>
)}
```

**3c. Microcopy del Textarea (líneas ~200–213)**

- `<Label>`: `"Notas adicionales (se anexan al final del Parágrafo PRIMERO)"`.
- `placeholder`: `"Ej: 'El otorgamiento se realiza en las oficinas del banco por conveniencia operativa.'"` (se conserva — ya es un buen ejemplo corto).
- Reemplazar el helper de abajo (`<p>` líneas ~209–213) por:

```tsx
<p className="text-[10px] text-muted-foreground leading-snug">
  Texto <span className="font-semibold">corto</span> que se añade al final del párrafo PRIMERO —
  no es la comparecencia completa. Si tienes una escritura o borrador con el estilo que quieres imitar,
  usa <span className="font-semibold">"Subir referencia"</span> abajo y la IA extraerá solo el estilo.
</p>
```

Y en la sección "Adaptar estilo desde un documento" agregar una nota:
```tsx
<p className="text-[10px] text-muted-foreground leading-snug">
  También puedes pegar un párrafo largo en el campo de notas y presionar Guardar:
  si detectamos estructura canónica, te ofreceremos usarlo como referencia automáticamente.
</p>
```

## Alcance / aislamiento

- El clasificador vive en `overrideSchema.ts` (isomórfico), no en el componente.
- La rama `rawText` de la edge es aditiva; el flujo existente `fileBase64` no cambia.
- No hay otros bancos consumiendo este modal hoy; cuando aparezcan, heredan `classifyOverrideError` gratis.
- No se toca `client.ts`, `types.ts`, ni el schema de BD. No hay migración.

## Tests de regresión

### Unit — `src/shared/prosaBancos/__contract__/overrideSchema.test.ts` (extender)
1. `classifyOverrideError(zodErrorConMarcadorCanónico) → kind === "canonical_marker"`.
2. `classifyOverrideError(zodErrorConTokenProhibido) → kind === "forbidden_token"`.
3. `classifyOverrideError(zodErrorPor2001Chars) → kind === "too_long"`.
4. `classifyOverrideError(new Error("otro")) → null`.

### Unit — nuevo `adaptar-estilo-prosa/index_test.ts` o inline
5. POST con `rawText` válido devuelve 200 y `notas_sugeridas` no vacías (mock del gateway).
6. POST sin `rawText` ni `fileBase64` → 400.
7. POST con `rawText` > 8000 chars → 400.
8. Sanitización: si Gemini devolviera un marcador canónico, la edge sigue respondiendo `{ notas_sugeridas: "", warning }` (test ya existente, verificar que aplica a la rama `rawText`).

### Component/integration — `ProsaApoderadoModal.test.tsx` (nuevo)
9. Pegar párrafo con `"COMPARECIÓ:"` y clic en Guardar → aparece la banda con botón "Usar como referencia de estilo", **no** aparece el JSON crudo en el toast.
10. Pegar texto de 2001 caracteres → toast normal con "Máximo 2000 caracteres...", banda de rescate NO aparece.
11. Con la banda visible, clic en el botón → se llama `supabase.functions.invoke("adaptar-estilo-prosa", { body: { rawText, baseContext } })` (mock), el `Textarea` se sustituye por `notas_sugeridas`, la banda desaparece.
12. Modificar el textarea manualmente después del error → la banda de rescate desaparece (state `rescueText` se limpia).

## Fuera de alcance
- Ampliar `FORBIDDEN_CANONICAL_MARKERS` a otros bancos: cuando se sume un segundo banco.
- Validación en vivo (mientras el usuario escribe) bajo el textarea: se puede añadir después con debounce si la fricción persiste.
