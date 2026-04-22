

## Coherencia notarial — Bloque único Notaría (número + letras + ordinal)

### Problema
El número de la notaría hoy se maneja como 3 campos sueltos editables independientemente. En el preview se renderizan como 2-3 cajas moradas separadas (screenshot: `QUINTO` y `(4to)` aparecen como variables independientes y desincronizadas). El usuario puede dejarlos incoherentes y no hay derivación automática.

### Solución
**Una sola fuente de verdad: el número entero.** Letras y ordinal se derivan automáticamente. El usuario edita un input principal; los demás se rellenan en vivo y son visualmente un único bloque morado en el preview, **siempre con el orden notarial colombiano: `LETRAS (Nº)`** (ej. `QUINTA (5.º)`).

### Cambios

**1. `src/lib/legalFormatters.ts` — Helpers nuevos**

Reutilizar `numberToWordsLegal` ya existente:

- `numberToWords(n)` — wrapper público.
- `numeroNotariaToLetras(n)` — devuelve siempre **femenino** (la "notaría" es femenino en español notarial colombiano):
  - 1-10: ordinales especiales `PRIMERA, SEGUNDA, TERCERA, CUARTA, QUINTA, SEXTA, SÉPTIMA, OCTAVA, NOVENA, DÉCIMA`.
  - >10: cardinal en femenino → `VEINTIUNA`, `SESENTA Y CINCO`, etc. (ajustando `un→una`, `veintiún→veintiuna`).
  - Output siempre en MAYÚSCULAS.
- `numeroToOrdinalAbbr(n, formato: "volada"|"to")` — **default `"volada"`** (estándar elegante de escrituras públicas):
  - `5,"volada"` → `"5.ª"` (femenino — coherente con "notaría"); opción `"5.º"` solo si se pide masculino explícito.
  - `5,"to"` → `"5ta"` (femenino) / `"5to"` (masculino) como opción secundaria.
  - Mantener compatibilidad con valores existentes en BD (`"5o"`, `"21a"`).

**2. `src/components/tramites/DocxPreview.tsx` — Auto-derivación + agrupación visual con orden fijo**

a) **Derivación al construir replacements** (en `buildReplacements`, ~línea 740):
   Si `numero_notaria` tiene valor pero `numero_notaria_letras` o `numero_ordinal` están vacíos, derivarlos al vuelo. Respetar overrides manuales (`manualFieldOverrides`).

b) **Agrupación visual con orden canónico forzado** (post-process tras sustituciones, ~línea 818):
   - **Independientemente del orden en que aparezcan los placeholders en el template o en el HTML resultante**, detectar la presencia adyacente (con tolerancia a paréntesis y whitespace) de los spans `notaria_numero_letras` y `notaria_ordinal` y reescribir el bloque al orden canónico:
     ```
     <span data-group="notaria-numero" style="background:#f5f3ff;border-bottom:1px dashed #6d28d9;border-radius:2px;padding:0 2px">
       <span data-field="notaria_numero_letras">QUINTA</span> (<span data-field="notaria_ordinal">5.ª</span>)
     </span>
     ```
   - Regex flexible que captura ambos spans en cualquier orden:
     ```
     /(<span data-field="notaria_(?:numero_letras|ordinal)"[^>]*>[^<]*<\/span>)\s*\(?\s*(<span data-field="notaria_(?:numero_letras|ordinal)"[^>]*>[^<]*<\/span>)\s*\)?/g
     ```
     Luego identificar cada span por `data-field` y emitir SIEMPRE en el orden `letras (ordinal)`, descartando paréntesis del template y poniéndolos manualmente.
   - Los spans hijos pierden `border-bottom` y `background` propios (solo conservan `data-field` para edición individual y `cursor:pointer`); el contorno morado vive solo en el wrapper `data-group`.
   - Si solo uno de los dos está presente, NO agrupar (mantener span individual).

c) **Click handler**: extender el listener de clicks del preview para que cuando el target esté dentro de `[data-group="notaria-numero"]`, se abra un popover de edición de bloque con los 3 sub-campos (número, letras, ordinal) en una sola tarjeta. Implementación: nuevo componente `NotariaBlockEditPopover.tsx` (basado en `VariableEditPopover.tsx`) con 3 inputs y toggle de formato ordinal.

**3. `src/pages/Validacion.tsx` — Panel "Datos de la Notaría"**

a) **Reorganización** (en `renderNotariaInput` y grid ~líneas 2137-2208):
   - `numero_notaria` primero, full-width, label `"Número de notaría (genera letras y ordinal)"`.
   - Sub-bloque visual debajo (borde izquierdo discreto) con `numero_notaria_letras` y `numero_ordinal`, label `"Derivados — editables"` y placeholders mostrando el valor auto-derivado en gris.
   - `onChange` de `numero_notaria` actualiza letras/ordinal salvo dirty-flag (`Set<keyof NotariaTramite>` `notariaManualOverrides` local).
   - Botón micro `↻` junto a cada derivado para revertir a auto.
   - Toggle `5.ª ⇄ 5ta` en el sub-bloque (default `5.ª`).

b) **Nota visual al usuario**: pequeño hint debajo del bloque: *"En el documento aparecerá como: **QUINTA (5.ª)**"* para reforzar el orden canónico.

### Verificación
1. `65` → letras `SESENTA Y CINCO`, ordinal `65.ª`. ✅
2. Preview siempre muestra `QUINTA (5.ª)` en ese orden, aunque el template tenga `{notaria_ordinal} {notaria_numero_letras}`. ✅
3. Una sola caja morada agrupada, no dos. ✅
4. Toggle a `5ta` regenera y agrupa igual. ✅
5. Editar letras manualmente → ordinal y número intactos; cambiar número ya no pisa letras (dirty). ✅
6. Click en bloque agrupado del preview abre popover con los 3 sub-campos. ✅
7. Trámites existentes con `5o` / `21a` siguen renderizando sin romperse. ✅

### Archivos modificados (3) + 1 nuevo
- `src/lib/legalFormatters.ts` — helpers nuevos (~70 líneas).
- `src/components/tramites/DocxPreview.tsx` — derivación + post-process de agrupación canónica + handler `data-group` (~60 líneas).
- `src/pages/Validacion.tsx` — sub-bloque notaría rediseñado + dirty tracking + toggle formato (~70 líneas).
- `src/components/tramites/NotariaBlockEditPopover.tsx` — **nuevo** (~120 líneas, derivado de `VariableEditPopover`).

### Lo que NO se toca
Estructura `NotariaTramite`, persistencia `metadata.notaria_tramite`, sugerencias Claude (`OcrSuggestion`), template Word, Edge Functions, auto-save.

### Riesgos
- Trámites existentes con letras/ordinal incoherentes con el número se respetan (no auto-pisar al cargar). La derivación solo aplica si el campo está vacío o si el usuario edita el número sin haber tocado el derivado.
- Edge cases (`0`, no numérico): `parseInt` defensivo; si falla, no derivar.

