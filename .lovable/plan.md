

## Auditoría senior — validación exhaustiva del plan

Revisé el código real (`Validacion.tsx` 851-874, `legalFormatters.ts`, `DocxPreview.tsx` handler de apply, mecanismo de overrides). El plan original es correcto en diagnóstico pero tiene **3 puntos débiles** que comprometen la solución agnóstica. Los corrijo aquí.

### Diagnóstico confirmado

**Bug A (raíz real):** `handleFieldEdit` solo cubre `__override__*`, `FIELD_TO_INMUEBLE`, `FIELD_TO_ACTOS`. ~30 placeholders del template (notaría, escritura, fechas, derivados) caen en el `else` silencioso → el ✓ no produce ningún cambio de estado → visor no re-renderiza → usuario percibe el botón roto.

**Bug B (coherencia):** sin capa de normalización tipográfica, "bogota" rompe la consistencia con el resto del documento en MAYÚSCULAS.

### Debilidades del plan original (a corregir)

**1. El mapa `FIELD_TO_NOTARIA_TRAMITE` NO es agnóstico.**
Mantener una lista hardcodeada de ~10 campos de notaría reproduce el mismo problema en 6 meses cuando se añadan placeholders nuevos. **Solución agnóstica real:** un único fallback universal vía `overrides` resuelve el 100% de campos no mapeados. Los mapas existentes (`INMUEBLE`/`ACTOS`) se mantienen porque alimentan estado persistido en BD; pero para notaría/escritura/derivados, el `override` semántico es suficiente y se persiste igual en `metadata.overrides`.

**Decisión:** NO añadir `FIELD_TO_NOTARIA_TRAMITE`. Solo fallback universal.

**2. El fallback override necesita el TEXTO ANCLA real, no el `field`.**
`onCreateOverride(originalText, newText)` opera sobre cadenas literales del XML. Si paso `field` como ancla no encuentra match. **Solución:** `DocxPreview.handleFieldApply` ya tiene acceso al `textContent` del span clickeado (vía `editPopover`). Debe propagarlo al callback. Ajuste: extender la firma de `onFieldEdit(field, value, anchorText?)` para que `Validacion.tsx` pueda hacer override genérico cuando no hay mapping.

**3. Normalización por sufijo es frágil.**
`*_proper` / `*_lower` no son convención garantizada del template. **Solución robusta:** tabla de reglas por familia de campo (no por sufijo), con default `UPPER` para texto y passthrough para numéricos/fechas. Documentado en una sola constante.

### Plan refinado (agnóstico, raíz)

**Archivo 1 — `src/lib/legalFormatters.ts`** (+30 líneas)
Nueva función `normalizeFieldCasing(field, value)`:
- Numéricos puros (`/numero|ordinal|decreto/` y no contienen `letras`) → `value.trim()`.
- Fechas (`/fecha/`) → `value.trim()`.
- Sufijo explícito `_lower` → `toLowerCase`.
- Sufijo explícito `_proper` o familia `nombre|notario_nombre|notario_decreto_nombre` → Title Case (helper local).
- Default → `toUpperCase()` con `localeCompare` español (preserva tildes).

**Archivo 2 — `src/pages/Validacion.tsx`** (~25 líneas)
- Importar `normalizeFieldCasing`.
- En `handleFieldEdit(field, value, anchorText?)`:
  1. `const v = normalizeFieldCasing(field, value)`.
  2. Mantener ramas existentes (`__override__`, `FIELD_TO_INMUEBLE`, `FIELD_TO_ACTOS`) usando `v`.
  3. **Nuevo `else` universal:** si `anchorText` existe y es distinto de `v`, llamar `handleCreateOverride(anchorText, v)`. Esto cubre TODOS los placeholders no mapeados sin enumerarlos.

**Archivo 3 — `src/components/tramites/DocxPreview.tsx`** (~5 líneas)
- En `handleFieldApply`: pasar el `textContent` original del span como tercer argumento a `onFieldEdit(field, value, anchorText)`.
- Tipar `onFieldEdit?: (field: string, value: string, anchorText?: string) => void`.

**Archivo 4 — `src/components/tramites/VariableEditPopover.tsx`** (~10 líneas)
- Calcular `previewNormalized = normalizeFieldCasing(fieldName, value)` localmente (importar el helper).
- Si `previewNormalized !== value && value.length > 0` → mostrar línea sutil bajo el input: `Se guardará como: {previewNormalized}` (text-[11px] text-muted-foreground).
- No bloquea ni transforma el input — solo transparenta.

### Por qué esto es la solución de raíz

| Aspecto | Antes | Después |
|---|---|---|
| Cobertura de campos | ~15 mapeados, ~30 silenciosos | **100%** (mapeo + fallback universal) |
| Mantenibilidad al añadir placeholder | Requiere editar mapa | **Cero código** — funciona automáticamente |
| Coherencia tipográfica | Manual del usuario | Automática + transparente |
| Persistencia | Solo campos mapeados se guardan en BD | Mapeados → tablas; resto → `metadata.overrides` (ya persistido) |
| Riesgo de regresión | — | Mínimo: ramas existentes intactas, solo se añade `else` final |

### Verificación end-to-end

1. `notaria_circulo` → "bogota" → ✓ → visor muestra **BOGOTÁ** verde, persistido en `metadata.overrides`. ✅
2. `escritura_numero` → "1234" → ✓ → visor muestra **1234** (numérico, sin upper). ✅
3. `fecha_escritura_corta` → "02-02-2018" → ✓ → visor muestra texto literal sin tocar. ✅
4. `inmueble.matricula` → "50c-1234567" → ✓ → MAYÚSCULA + persiste en tabla `inmuebles`. ✅
5. Pista "Se guardará como: …" aparece solo cuando hay diferencia real. ✅
6. Placeholder nuevo añadido al template mañana → funciona sin cambios de código. ✅

### Lo que NO se toca
Mecanismo de overrides, OCR, paginación, portal del popover, posicionamiento, `getSuggestionForField`, render de spans, estilos.

### Riesgos
Muy bajos. El fallback reutiliza `handleCreateOverride` ya en producción. La normalización es pura y testeable. Cambio de firma de `onFieldEdit` es retrocompatible (3er arg opcional).

### Archivos modificados (4)

| Archivo | Cambio |
|---|---|
| `src/lib/legalFormatters.ts` | + `normalizeFieldCasing` |
| `src/pages/Validacion.tsx` | normalización + fallback override universal |
| `src/components/tramites/DocxPreview.tsx` | propagar `anchorText` a `onFieldEdit` |
| `src/components/tramites/VariableEditPopover.tsx` | preview "Se guardará como: …" |

