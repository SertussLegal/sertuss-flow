

## Plan: Inyectar contexto `notaria_tramite` en prompts de Gemini

Completar el último paso pendiente del plan de notaría: pasar los datos de `notaria_tramite` desde el cliente hasta los prompts de las dos edge functions de generación, con instrucción explícita de usar líneas en blanco si están vacíos.

### Cambios

**1. `supabase/functions/process-expediente/index.ts`**
- Aceptar `notaria_tramite` en el body del request (junto a los datos del expediente que ya recibe).
- Inyectar al `systemPrompt` (o `userPrompt`) un bloque:
  ```
  DATOS DE LA NOTARÍA PARA ESTE TRÁMITE:
  Número: {numero_notaria} ({numero_notaria_letras})
  Ordinal: {numero_ordinal}
  Círculo: {circulo}
  Departamento: {departamento}
  Notario: {nombre_notario}
  Tipo: {tipo_notario}
  Decreto: {decreto_nombramiento}
  Género: {genero_notario}

  REGLA CRÍTICA: Usa estos datos en TODAS las referencias a la notaría
  en el documento. Si algún campo está vacío, usa líneas en blanco
  (___________) en su lugar. NUNCA uses datos de una notaría específica
  que no fueron proporcionados.
  ```
- Si `notaria_tramite` es `undefined` o todos sus campos están vacíos, igual incluir el bloque con `___________` en cada campo (refuerza el comportamiento).

**2. `supabase/functions/generate-document/index.ts`**
- Idem: aceptar `notaria_tramite` en el body, inyectar el mismo bloque al `systemPrompt`.
- Agregar al schema del tool `fill_template` los campos de notaría (`notaria_numero_letras`, `notaria_ordinal`, `notaria_circulo`, `notario_nombre`, `notario_tipo`, etc.) para que la IA pueda devolverlos estructurados — con instrucción explícita de devolver `___________` si no hay dato.

**3. `src/pages/Validacion.tsx`** (cliente)
- En las llamadas a `supabase.functions.invoke("process-expediente", ...)` y `"generate-document"`, agregar `notaria_tramite: notariaTramite` al payload.

### Reglas críticas

- Si los campos están vacíos → la IA debe devolver `___________`, NO inventar datos ni usar los de Notaría Quinta.
- El cliente siempre envía el objeto (aunque tenga campos vacíos), para que el prompt no tenga que adivinar.
- No se modifica nada del flujo de extracción OCR ni de la validación con Claude — solo el contexto de generación.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `supabase/functions/process-expediente/index.ts` | Aceptar `notaria_tramite`, inyectar bloque al prompt |
| `supabase/functions/generate-document/index.ts` | Aceptar `notaria_tramite`, inyectar bloque al prompt, extender schema del tool |
| `src/pages/Validacion.tsx` | Pasar `notariaTramite` en los `invoke()` de ambas edge functions |

### Riesgos

Bajo. Es aditivo. Si `notaria_tramite` no llega, el prompt usa `___________` por defecto, que es el comportamiento seguro.

