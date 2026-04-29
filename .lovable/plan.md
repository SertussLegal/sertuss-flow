
## Diagnóstico (validado contra el DOM real)

Inspeccioné el trámite `003e40e5-…` en vivo. El HTML real del párrafo es:

```html
<strong>OTORGADA ANTE EL NOTARIO ___________ ( ___________ ) ) DEL CÍRCULO DE ___________</strong>
```

Texto plano dentro de `<strong>`. **Cero spans interactivos**. Por eso al hacer click no pasa nada — `handleContentClick` busca `[data-field]` / `[data-override]` y no los encuentra.

### Dos bugs encadenados

**Bug 1 — Frontend:** `src/components/tramites/DocxPreview.tsx` líneas 769-781. Cuando hay `textoFinalWord` (texto generado por Gemini), el `useEffect` hace `return` antes de toda la lógica que envuelve `___________` en `<span class="var-pending" data-field="…">` y antes del agrupador notaría. Resultado: los blanks de la rama IA son texto plano no clickeable.

**Bug 2 — Backend:** `supabase/functions/process-expediente/index.ts` línea 274. El prompt arma `Número: ${num} (${letras})` que cuando ambos están vacíos produce `Número: ___________ (___________)`. Combinado sin instrucción tipográfica, Gemini escribe `OTORGADA ANTE EL NOTARIO ___________ (___________))` con cierre de paréntesis duplicado.

---

## Plan (dos archivos, sin schema, sin componentes nuevos)

### 1. `src/components/tramites/DocxPreview.tsx` — rama `textoFinalWord`

Antes del `setHtml(sanitize(result))` actual (línea 779), añadir tres pases que **reusan exactamente los mismos estilos, clases y popover** que ya usa la rama del template:

- **Pase A — Limpieza tipográfica defensiva** sobre el texto IA:
  - `))` → `)`, `((` → `(`
  - `___________ (___________)` → `___________` (paréntesis redundantes con solo blanks)
  - `( )` vacío → eliminar
  - Espacios duplicados y espacios antes de coma/punto
- **Pase B — Inferencia semántica de `data-field` para el bloque notario**, usando la misma clase `var-pending` y el mismo `pendingRedStyle` ya definidos en el archivo:
  - `NOTARIO/NOTARÍA ___________` → `data-field="notaria_numero_letras"`
  - `CÍRCULO DE ___________` → `data-field="notaria_circulo"`
  - `DEPARTAMENTO DE ___________` → `data-field="notaria_departamento"`
- **Pase C — Wrap genérico de blanks restantes** con `data-field="__ai_blank__"` y la misma clase `var-pending`. La detección de "está dentro de atributo / dentro de span" reusa la lógica del FINAL PASS existente (líneas 902-936) para evitar doble envoltura.

Con esto, **al hacer click** el flujo pasa por el mismo `handleContentClick` (línea 1059) → mismo `VariableEditPopover` (línea 1400) → misma persistencia en `manualFieldOverrides`. Cero componentes nuevos, cero estilos nuevos.

Para `__ai_blank__` (blanks que no se pudieron mapear), pequeño ajuste en `handleContentClick`: cuando el campo es `__ai_blank__`, abrir el popover sin sugerencia OCR (no hay mapeo conocido) y al aplicar enrutar vía `onCreateOverride` para guardarlo como `TextOverride` con contexto, igual que el flujo de selección de texto que ya existe.

### 2. `supabase/functions/process-expediente/index.ts` — fix en origen

- En `buildNotariaBlock`: cuando `numero_notaria_letras` esté vacío, **omitir el paréntesis**. Línea queda solo `Número: ___________` en lugar de `Número: ___________ (___________)`.
- Añadir al bloque `REGLA CRÍTICA` instrucción tipográfica explícita: nunca emitir `( )`, nunca paréntesis con solo blanks dentro, nunca `))`.
- **Post-proceso defensivo** sobre `texto_final_word` antes de devolverlo al cliente: las mismas regex de limpieza del Pase A, aplicadas server-side. Doble red para futuras alucinaciones del modelo.

### 3. Despliegue y validación

- Desplegar `process-expediente` con `supabase--deploy_edge_functions`.
- En el preview, verificar que cada `___________` cerca de `OTORGADA ANTE EL NOTARIO`:
  - Está envuelto en `<span data-field="…" class="var-pending">`
  - Abre `VariableEditPopover` al hacer click (mismo popover que el resto)
  - Tras editar, queda en color púrpura (`var-user-edited`) y persiste
  - Ya no hay `) )` ni `( )` vacíos en el texto

---

## Garantía de consistencia

Todo el fix **reusa los componentes y comportamientos existentes**:

| Pieza | Reuso |
|---|---|
| Popover de edición | `VariableEditPopover` (sin cambios) |
| Estilos de blanks | `var-pending` + `pendingRedStyle` ya definidos |
| Estilos de editados | `var-user-edited` ya definido |
| Persistencia | `manualFieldOverrides` (sin cambios) |
| Override semántico | `onCreateOverride` / `TextOverride` ya existentes |
| Detección click | `handleContentClick` con mínimo ajuste para `__ai_blank__` |

Sin nuevos componentes, sin nuevas tablas, sin nuevos estilos.
