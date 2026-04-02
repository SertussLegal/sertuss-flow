

## Plan: Integrar validación Claude al flujo de "Previsualizar"

### Aclaración del flujo

Tienes razón. El flujo real es:
1. Usuario carga documentos en `DocumentUploadStep` → click "Continuar"
2. Se abre la pantalla de `Validacion.tsx` que **ya muestra** el `DocxPreview` a la izquierda y los tabs con campos a la derecha — no hay botón para ver la previsualización, es automática.
3. El botón "Previsualizar" (línea 760) abre un `PreviewModal` que es el **resumen final antes de generar el Word**.

### Punto de integración correcto

La validación de Claude debe ejecutarse **cuando el usuario hace clic en "Previsualizar" (el botón dorado en el header)**, que es el paso previo a generar el documento Word. Es decir, se intercepta el `onClick={() => setPreviewOpen(true)}` del botón en línea 762.

El `DocxPreview` del panel izquierdo sigue funcionando igual — es reactivo y se actualiza en tiempo real con los datos de los tabs. No se toca.

### Implementación

**En `src/pages/Validacion.tsx`**:

1. **Imports**: `validarConClaude`, `tieneErroresCriticos`, `contarPorNivel` del servicio
2. **3 estados nuevos**: `validando`, `validacionResultado`, `validacionDialogOpen`
3. **Función `handlePrevisualizar`**:
   - `validando = true`, muestra spinner en botón
   - Construye payload con datos de los 4 tabs (vendedores, compradores, inmueble, actos)
   - Agrega flags a `validacionesApp` según estado actual
   - Llama `validarConClaude`
   - Decide según resultado:
     - Aprobado → abre `PreviewModal` directo
     - Solo advertencias → toast informativo + abre `PreviewModal`
     - Errores críticos → abre `AlertDialog` con lista de problemas. Botones: "Corregir" / "Continuar de todas formas"
     - Error sistema → abre `PreviewModal` sin mostrar nada
   - `validando = false`
4. **Botón "Previsualizar"**: cambia `onClick` a `handlePrevisualizar`, muestra "Validando..." con spinner cuando `validando === true`
5. **AlertDialog**: lista validaciones agrupadas por nivel (rojo = error, amarillo = advertencia, azul = sugerencia), puntuación y retroalimentación general

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/Validacion.tsx` | Interceptar botón Previsualizar con validación Claude, agregar AlertDialog de errores |

1 solo archivo. No se toca `DocxPreview`, `PreviewModal`, ni ningún otro componente.

