

## Diagnóstico (revisión completa)

### Bug del popover (causa raíz)
`DocxPreview.tsx` líneas **919-922**: cuando el span tiene texto `___________` (campo vacío), el handler hace `onScrollToField` y retorna. **Nunca abre el popover en campos vacíos** — solo en campos ya resueltos. Ese es exactamente el bug del usuario.

### Componentes existentes (evitar duplicación)
- ✅ `VariableEditPopover.tsx` — popover de edición ya funciona, solo necesita aceptar una sugerencia opcional.
- ✅ `OcrSuggestion.tsx` — **NO reutilizar**: es un wrapper de Popover para inputs de formularios. Anidarlo dentro de otro popover causa conflictos de Radix Portal y posicionamiento. Mejor renderizar la sugerencia inline dentro de `VariableEditPopover`.
- ✅ `extractedDocumento` y `extractedPredial` ya llegan como props a `DocxPreview` — la fuente de sugerencias ya existe, no hay que cablear nada nuevo.

## Solución (mínima, sin doble esfuerzo)

### Cambio 1 — Reparar el click en campos vacíos
**Archivo:** `src/components/tramites/DocxPreview.tsx` (líneas 914-935)

Reordenar la lógica: **siempre abrir el popover** al hacer click en `[data-field]`. El "scroll al input" se vuelve un botón secundario *dentro* del popover (no un comportamiento exclusivo). Así el usuario puede:
- Editar directamente desde el visor (caso principal), o
- Saltar al formulario lateral si lo prefiere.

### Cambio 2 — Sugerencia OCR condicional dentro del popover
**Archivo:** `src/components/tramites/VariableEditPopover.tsx`

Añadir prop opcional `suggestion?: { value: string; source: string }`. Si está presente, renderizar un bloque compacto encima del input:

```
┌─ Sugerencia (Cert. Tradición) ──┐
│ MATRICULA 50C-1234567   [Usar]  │
└─────────────────────────────────┘
```

Si `suggestion` es `undefined` → no se renderiza nada (cero ruido visual). Botón "Usar" solo prellena el input; el usuario sigue confirmando con ✓ o Enter.

### Cambio 3 — Mapeo `fieldName → sugerencia OCR`
**Archivo:** `src/components/tramites/DocxPreview.tsx` (dentro de `handleContentClick`)

Función pura `getSuggestionForField(field, extractedDocumento, extractedPredial, inmueble, actos)` que devuelve la sugerencia o `undefined`. Cobertura inicial (solo campos donde realmente hay datos OCR cruzables):

| Campo del template | Fuente OCR |
|---|---|
| `inmueble.matricula`, `matricula_inmobiliaria` | `extractedDocumento` (cert. tradición) |
| `inmueble.cedula_catastral`, `identificador_predial` | `extractedPredial` |
| `inmueble.direccion`, `direccion_inmueble` | `extractedPredial` o `extractedDocumento` |
| `actos.entidad_bancaria` | `bankDirectory` lookup (si hay NIT) |
| `notaria_previa_numero`, `escritura_num_*` | `extractedDocumento.titulo_antecedente` |

Si no hay match → no se muestra sugerencia. **Sin valores hardcodeados, sin riesgo de mostrar datos basura.**

## Archivos modificados

| Archivo | Cambio | Líneas aprox. |
|---|---|---|
| `src/components/tramites/DocxPreview.tsx` | Reordenar handler click (siempre abre popover) + función `getSuggestionForField` | ~40 líneas |
| `src/components/tramites/VariableEditPopover.tsx` | Prop `suggestion?` + render condicional + botón "Ir al formulario" | ~25 líneas |

## Lo que NO se modifica (importante)
- ❌ `OcrSuggestion.tsx` — sigue intacto para los formularios laterales.
- ❌ Lógica de `onScrollToField` — sigue disponible como acción secundaria.
- ❌ `processLoops`, `buildReplacements`, generación de spans `[data-field]` — ya funcionan.
- ❌ Estado del visor, paginación, overrides — sin tocar.

## Verificación esperada
1. Click en campo rojo `___________` → abre popover con input vacío y foco.
2. Si hay OCR para ese campo → bloque "Sugerencia" visible con botón "Usar".
3. Si no hay OCR → solo input + botones ✓/✗ (igual que hoy en campos resueltos).
4. Click en campo verde resuelto → comportamiento idéntico al actual.

## Riesgos
Mínimos. Cambios localizados a 2 archivos, retrocompatibles (la prop `suggestion` es opcional). El mapeo de sugerencias es puramente aditivo — si una clave no está mapeada, el popover funciona como antes.

