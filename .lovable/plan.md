

## Auditoría como UI Lead — Plan validado y refinado

### Problemas confirmados en el código actual

| # | Severidad | Archivo | Línea | Problema |
|---|---|---|---|---|
| 1 | 🔴 Crítico | `VariableEditPopover.tsx` | 81 | `mousedown` listener montado sin diferir → cierra el popover en el mismo click que lo abrió (race condition real) |
| 2 | 🔴 Crítico | `DocxPreview.tsx` | 979, 961, 1009 | `target.getAttribute()` falla si el click cae en un nodo hijo del span |
| 3 | 🔴 Crítico | `DocxPreview.tsx` | 1219, 1236, 1318 | Popover renderizado dentro de contenedor con `transform: scale()` y `translateX()` → `position: fixed` se ancla al ancestro transformado, NO al viewport |
| 4 | 🟡 Medio | `VariableEditPopover.tsx` | 92-93 | Clamp solo con `Math.min`, falta `Math.max(8, …)` para evitar coordenadas negativas |

### Por qué el plan original es correcto
Los 4 fixes (delegación con `closest()`, `setTimeout(0)` en listener, `createPortal` a `body`, clamp completo) atacan exactamente cada causa raíz. No hay duplicación con código existente — son ajustes quirúrgicos sobre 2 archivos.

### Refinamientos como UI Lead

**A. Listener: usar `pointerdown` capture-phase con guardia por `target`**
En lugar de solo `setTimeout(0)`, usar `pointerdown` con `{ capture: true }` y validar que el target NO sea el span `[data-field]` que abrió el popover. Esto es más robusto que confiar en el orden de mounting.

**B. Portal: `createPortal` a `document.body`**
Resuelve simultáneamente:
- El anchor incorrecto por `transform`.
- El `overflow: hidden` del contenedor de página que podría recortar el popover.
- Z-index garantizado encima del visor.

**C. Coordenadas: ya viajan correctas**
`getBoundingClientRect()` en el span devuelve coords ya en sistema viewport (pese al `transform`). El portal hace que `position: fixed` finalmente respete esas coordenadas. **No hay que recalcular** — el bug era de anclaje, no de cálculo.

**D. Clamp completo**
```ts
const top = Math.max(8, Math.min(position.top, window.innerHeight - 240));
const left = Math.max(8, Math.min(position.left, window.innerWidth - 328));
```

**E. Delegación consistente**
Aplicar `closest()` también a `data-sugerencia-idx` y `data-override` en el mismo handler, no solo a `data-field`. Evita el mismo bug latente en sugerencias IA y overrides.

### Cambios finales

**`src/components/tramites/VariableEditPopover.tsx`** (~15 líneas)
- Importar `createPortal` de `react-dom`.
- Envolver el `return` en `createPortal(<div>…</div>, document.body)`.
- Cambiar listener a `pointerdown` con `setTimeout(0)` y `{ capture: true }`.
- Clamp simétrico con `Math.max(8, …)`.

**`src/components/tramites/DocxPreview.tsx`** (~8 líneas)
- En `handleContentClick` (línea 957): obtener `const target = e.target as HTMLElement` y derivar:
  - `const sugEl = target.closest('[data-sugerencia-idx]') as HTMLElement | null`
  - `const fieldEl = target.closest('[data-field]') as HTMLElement | null`
  - `const overrideEl = target.closest('[data-override]') as HTMLElement | null`
- Usar esos elementos para `getAttribute`, `getBoundingClientRect` y `textContent`.

### Lo que NO se toca
- `getSuggestionForField` — funciona bien.
- Estilos del popover — intactos.
- Generación de spans `[data-field]`, paginación, overrides, OCR.
- `OcrSuggestion.tsx`, formularios laterales, edición semántica.

### Verificación
1. Click en `___________` rojo → popover aparece **y permanece abierto**.
2. Click dentro del input del popover → no cierra.
3. Click en zona escalada del visor → popover se posiciona correctamente al lado del campo.
4. Click en sugerencia IA o texto editado → mismo comportamiento robusto (closest aplica).
5. Esc / click fuera → cierra.
6. Popover nunca queda fuera del viewport (clamp simétrico).

### Riesgos
Mínimos. Cambios localizados, retrocompatibles. `createPortal` y `pointerdown` capture son patrones estándar de React/DOM.

