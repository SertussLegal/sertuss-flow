

## Análisis UX — "Ir al formulario" condicional

### Problema
El botón "Ir al formulario" aparece en TODOS los popovers, pero muchos campos del template (ej. `notaria_numero_letras`, `escritura_numero`, antecedentes, fechas) **no tienen un input correspondiente en el formulario lateral**. Click → no pasa nada o salta a un lugar irrelevante. Mala UX.

### Decisión recomendada (como UX Lead)
**Render condicional basado en mapeo explícito.** Solo mostrar el botón cuando exista una ruta real al campo en el formulario lateral. Si no existe → ocultarlo. Cero ruido, cero promesas vacías.

Esta es la opción correcta porque:
- **Honestidad UX**: no mostramos affordances que no funcionan.
- **Edición in-place ya cubre el 100%**: el popover mismo permite editar cualquier campo, así que el botón es secundario, no esencial.
- **Mantiene el atajo donde sí aporta valor** (campos complejos del formulario: inmueble, comparecientes, actos).

### Implementación

**1. Whitelist de campos con destino real en el formulario** (`DocxPreview.tsx`)
Crear un `Set<string>` con los `fieldName` que SÍ tienen sección/input en `ExpedienteSidebar` / formularios laterales:
```
inmueble.*, actos.*, comparecientes_*, valor_*, entidad_*, etc.
```
Excluir: `notaria_numero_letras`, `escritura_numero`, `escritura_fecha`, antecedentes sueltos, campos puramente computados.

**2. Pasar `onGotoForm` solo si el campo está en la whitelist**
```ts
onGotoForm={FORM_FIELDS.has(fieldName) ? () => onScrollToField(fieldName) : undefined}
```

**3. El popover ya respeta `onGotoForm` opcional** (`VariableEditPopover.tsx` línea ya existente: `{onGotoForm && (...)}`) — no hay cambio en ese archivo.

### Alternativa descartada
- ❌ "Mostrar botón siempre y dar feedback si no existe destino" → genera frustración.
- ❌ "Texto dinámico tipo 'Editar aquí únicamente'" → ruido visual sin valor.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | Constante `FORM_FIELDS` + paso condicional de `onGotoForm` al popover |

### Verificación
1. Click en `inmueble.matricula` → popover muestra "Ir al formulario" ✅
2. Click en `notaria_numero_letras` → popover SIN botón "Ir al formulario" ✅
3. Click en `actos.entidad_bancaria` → popover muestra el botón ✅
4. Edición in-place sigue funcionando para todos los campos ✅

### Riesgo
Mínimo. Cambio aditivo de ~15 líneas en un solo archivo. Whitelist se puede ampliar sin tocar el popover.

