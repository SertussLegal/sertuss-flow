

## Plan: Validación Claude en background después de cada carga

Agregar una llamada **adicional y no bloqueante** a `validarConClaude` después de que Gemini extraiga datos de cada documento. La validación existente del Previsualizar (Momento 2) **NO se toca**.

### Arquitectura

```text
[Gemini extrae] → [tabs se llenan] → [NUEVO: Claude valida en background]
                                          ↓
                            [estado validacionCampos] → [indicadores sutiles UI]
```

### Cambios concretos

**A) `src/pages/Validacion.tsx`**

1. **Nuevos estados** (cerca de línea 251):
   - `validacionCampos: ValidacionResultado | null` — último resultado de Claude
   - `validandoCampos: boolean` — para mostrar spinner discreto opcional
   - `bannerExpanded: boolean` — para banner colapsable de resumen

2. **Nueva función `validarDespuesDeCarga`** (justo antes de `handleSidebarUpload`):
   ```ts
   const validarDespuesDeCarga = useCallback(async (
     tipoDoc: "cedula" | "certificado" | "predial" | "escritura_previa" | "carta_credito" | "poder_notarial",
     datosDocumento: any,
     tabOrigen: "vendedores" | "compradores" | "inmueble" | "actos"
   ) => {
     if (!tramiteIdRef.current || !profile?.organization_id) return;
     setValidandoCampos(true);
     try {
       const resultado = await validarConClaude({
         modo: "campos",
         tramiteId: tramiteIdRef.current,
         organizationId: profile.organization_id,
         tipoActo: actos.tipo_acto || "compraventa",
         tabOrigen,
         datosExtraidos: {
           documento_cargado: { tipo: tipoDoc, datos: datosDocumento },
           vendedores, compradores, inmueble, actos,
         },
         validacionesApp: [
           ...(vendedores.length || compradores.length ? ["cruce_roles_certificado_completado"] : []),
           ...([...vendedores, ...compradores].some((p:any)=>p.pendiente) ? ["placeholders_pendientes_aplicados"] : []),
         ],
       });
       if (resultado.estado !== "error_sistema") {
         setValidacionCampos(resultado);
       }
       // Si error_sistema → silencio total (regla D)
     } catch {
       /* silencio */
     } finally {
       setValidandoCampos(false);
     }
   }, [profile?.organization_id, vendedores, compradores, inmueble, actos]);
   ```

3. **Disparar la validación** — al final del `try` exitoso de `handleSidebarUpload` (después de `toast` línea 1176), mapear `tipo` → `tabOrigen`:
   - `certificado_tradicion` → `inmueble` (también afecta vendedores)
   - `predial` → `inmueble`
   - `escritura_antecedente` → `vendedores`
   - `cedula_*` → tab según contexto (default `vendedores`)
   - `carta_credito` / `poder_notarial` → `actos`
   
   Llamar `validarDespuesDeCarga(tipoMapeado, d, tabOrigen)` **sin await** (fire-and-forget, en background).

4. **Indicadores sutiles en `TabsTrigger`** (líneas 1913-1916): agregar al lado del texto un ícono según severidad por tab:
   - Filtrar `validacionCampos.validaciones` por `campo` que empieza con el nombre del tab (`vendedores.`, `compradores.`, `inmueble.`, `actos.`).
   - Mostrar el ícono de mayor severidad encontrada: rojo `AlertCircle` (error), amarillo `AlertTriangle` (advertencia), azul `Info` (sugerencia), o nada si está limpio.
   - Wrapper en `Tooltip` con la `explicacion` de la primera validación.

5. **Banner colapsable opcional** (debajo de `<TabsList>`, antes de `<TabsContent>`): 
   - Solo si `validacionCampos.validaciones.length > 0`
   - Línea sutil: "ℹ️ 2 advertencias y 1 sugerencia detectadas tras la última carga · [Ver detalles ▾]"
   - Al expandir, lista cada validación con su `nivel`, `campo`, `explicacion`.
   - Botón [×] para descartar (setea `validacionCampos` a `null`).

### Reglas críticas respetadas

| Regla | Cumplimiento |
|---|---|
| No bloquea UI | Llamada sin `await` (fire-and-forget) |
| Si Claude falla → silencio | `error_sistema` no actualiza estado, `try/catch` silencioso |
| Usuario puede ignorar | Nada modal, solo indicadores visuales |
| Re-ejecuta solo en carga | Solo se llama desde `handleSidebarUpload` (no en edición manual) |
| Independiente del Momento 2 | Estado `validacionCampos` separado de `validacionResultado` |
| No toca flujo Gemini | Se llama DESPUÉS del `setX` exitoso, sin alterar el pipeline OCR |

### Detalles técnicos

- La edge function `validar-con-claude` ya existe y ya soporta `modo: "campos"` con `tab_origen`. **No requiere cambios en backend**.
- El historial se registra automáticamente en `historial_validaciones` (cada carga = una fila). Esto da trazabilidad sin trabajo extra.
- Costo: ~1 llamada Claude por documento cargado (~$0.001 por carga estimado). Aceptable.
- Se usa `Tooltip` de `@/components/ui/tooltip` (ya existe en el proyecto).

### Archivos a tocar

- `src/pages/Validacion.tsx` — único archivo modificado.

### Riesgos

- **Bajo**: la nueva función es aditiva. Si todo el bloque nuevo se rompe, el flujo de carga sigue funcionando porque la llamada es fire-and-forget en `try/catch`.
- **Latencia Claude (~2-4s)**: irrelevante porque corre en background.

