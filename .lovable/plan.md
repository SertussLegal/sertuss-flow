

## Auditoría del Plan — Resultado: 2 riesgos críticos, 2 riesgos medios, plan seguro con correcciones

### Riesgo Crítico 1: Bucle infinito en el useEffect propuesto

El plan propone agregar un `useEffect` que sincronice `extractedPredial` → `inmueble`:

```typescript
useEffect(() => {
  if (!extractedPredial) return;
  setInmueble(prev => { ... return { ...prev, ...updates }; });
}, [extractedPredial]);
```

**Problema**: En `Validacion.tsx` línea 127-132, ya existe un `useEffect` que marca `isDirty` cada vez que `inmueble` cambia. Al cambiar `inmueble` desde el nuevo effect, se dispara `isDirty → true`, lo que activa el autosave (línea 135-141). El autosave a su vez puede recargar metadata. Sin embargo, **no hay bucle infinito** porque:
- `setInmueble` con spread solo dispara re-render si el objeto es nuevo (siempre lo es con spread)
- Pero `extractedPredial` no cambia como resultado, así que el effect no re-dispara

**Riesgo real**: El effect **sí se ejecutará en cada recarga** de trámite (porque `loadTramite` hace `setExtractedPredial`), sobrescribiendo datos que el usuario ya editó manualmente.

**Corrección necesaria**: La guarda `!prev.estrato` es insuficiente. Se debe usar una bandera `isLoadingRef.current` para bloquear este effect durante la carga inicial, y verificar si los datos vienen de tabla relacional (`inmuebles`) — en cuyo caso NO aplicar el fallback:

```typescript
useEffect(() => {
  if (!extractedPredial || isLoadingRef.current) return;
  setInmueble(prev => {
    const updates: Partial<Inmueble> = {};
    // Solo aplicar si el campo está genuinamente vacío (no editado por usuario)
    if (extractedPredial.estrato && !prev.estrato) updates.estrato = extractedPredial.estrato;
    if (extractedPredial.valor_pagado && !prev.avaluo_catastral) updates.avaluo_catastral = extractedPredial.valor_pagado;
    return Object.keys(updates).length ? { ...prev, ...updates } : prev;
  });
}, [extractedPredial]);
```

Y el `return prev` sin cambios **evita** re-renders innecesarios cuando no hay updates.

---

### Riesgo Crítico 2: Regex de cédula catastral demasiado restrictivo

En `InmuebleForm.tsx` línea 160:
```typescript
/^\d{10,}$/.test(cedulaCatastral)
```

Esto **falla** con formatos reales como:
- `00-1101-0658-0070-9005` (con guiones)
- `001.101.0658.0070.9005` (con puntos)
- `00 1101 0658 0070 9005` (con espacios)

**Corrección**: Limpiar antes de validar:
```typescript
const cleanCedula = (cedulaCatastral || "").replace(/[\s.\-]/g, "");
if (cleanCedula && /^\d{10,}$/.test(cleanCedula)) {
  chipMapping.identificador_predial = cleanCedula;
  chipMapping.tipo_identificador_predial = "cedula_catastral";
}
```

Aplicar la misma limpieza en el bloque de predial (líneas 220-226).

---

### Riesgo Medio 1: buildReplacements genera objetos nuevos en cada render

`buildReplacements` está envuelto en `useCallback` con deps `[vendedores, compradores, inmueble, actos, notariaConfig, extractedDocumento, extractedPredial]`. Esto es correcto — solo se recalcula cuando cambian los datos. El `useEffect` que aplica replacements (línea 584-644) ya tiene un debounce de 500ms. **No hay riesgo de parpadeo**.

Sin embargo, hay una ineficiencia menor: las llamadas repetidas a `parseFechaDoc` dentro de IIFEs en líneas 545-549. Se pueden mover fuera del objeto literal. No es crítico.

---

### Riesgo Medio 2: onScrollToField con tabs ocultos

El plan propone un `onScrollToField` que active el tab correcto y scrollee al input. El riesgo es que React necesita un tick para renderizar el contenido del tab antes de poder scrollear. 

**Corrección necesaria**: Usar `requestAnimationFrame` o `setTimeout(0)` después de cambiar el tab activo:
```typescript
const onScrollToField = (field: string) => {
  // Determinar tab
  const tab = field.startsWith("inmueble") ? "inmueble" : "actos";
  setActiveTab(tab);
  // Esperar render del tab
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-field-input="${field}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLElement)?.focus();
  });
};
```

---

### Riesgo adicional: FIELD_TO_INMUEBLE incompleto

El mapeo `FIELD_TO_INMUEBLE` (líneas 31-49) no incluye `nupre` ni `estrato`. El plan menciona agregarlos pero no lo lista como paso explícito. Agregar:
```typescript
nupre: "nupre",
"inmueble.nupre": "nupre",
estrato: "estrato",
"inmueble.estrato": "estrato",
```

---

### Veredicto

El plan es **seguro para ejecutar** con las 4 correcciones mencionadas:

1. Agregar guarda `isLoadingRef.current` al useEffect de sync predial→inmueble, y retornar `prev` sin cambios cuando no hay updates
2. Limpiar cédula catastral (`replace(/[\s.\-]/g, "")`) antes de validar con regex
3. Usar `requestAnimationFrame` en `onScrollToField` para esperar render del tab
4. Agregar `nupre` y `estrato` a `FIELD_TO_INMUEBLE`

### Archivos a modificar (con correcciones integradas)

| Archivo | Cambio |
|---|---|
| `src/pages/Validacion.tsx` | useEffect con guarda `isLoadingRef`, FIELD_TO_INMUEBLE +4 entries, onScrollToField con rAF |
| `src/components/tramites/DocxPreview.tsx` | Fallbacks de predial en buildReplacements, highlighting rojo para pendientes, click→scroll |
| `src/components/tramites/InmuebleForm.tsx` | Regex con limpieza previa para cédula catastral en certificado y predial |

3 archivos. Sin cambios de DB.

