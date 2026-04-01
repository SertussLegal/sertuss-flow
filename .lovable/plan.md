

## Plan: No pre-llenar datos de personas desde el certificado de tradición

### Problema

Actualmente en `handleContinue` (líneas 286-302), cuando el certificado de tradición tiene personas listadas, estas se agregan a `extractedPersonas` con nombre y número de identificación extraídos del certificado. Esto pre-llena campos que deberían quedar vacíos si el usuario no aportó la cédula correspondiente.

Los datos de personas solo deben provenir del escaneo de cédulas. Si no se subió cédula, esa persona debe aparecer con campos vacíos (o no aparecer) para ser llenada manualmente después.

### Cambio en `src/components/tramites/DocumentUploadStep.tsx`

**1. Eliminar el merge de personas del certificado (líneas 286-302)**

Quitar el bloque que agrega personas del certificado de tradición a `extractedPersonas`. Solo las cédulas escaneadas deben poblar los datos de personas.

**2. Crear placeholders vacíos para propietarios sin cédula**

Para propietarios del certificado que no tienen cédula cargada, agregar entradas placeholder con:
- `nombre_completo`: nombre del certificado (solo como referencia)
- `numero_identificacion`: número del certificado (solo como referencia)
- Todos los demás campos vacíos (`""`)
- Flag `pendiente: true` para indicar que es un placeholder
- `rol: "vendedor"` (son propietarios)

Esto permite que aparezcan en el formulario de validación pero con campos personales en blanco.

**3. Actualizar texto de alerta de cédulas faltantes (línea 537)**

De: *"Debes cargarlas como Vendedores."*
A: *"Puedes continuar sin estas cédulas. Los campos correspondientes quedarán en blanco en la escritura para completar manualmente en la notaría."*

### Cambio en `supabase/functions/generate-document/index.ts`

**4. Agregar instrucción al prompt para campos faltantes**

En el `systemPrompt`, agregar la regla:
*"Si un vendedor o comprador tiene datos incompletos (sin estado civil, sin dirección, sin lugar de expedición), deja esos campos con líneas en blanco (___________) para ser llenados manualmente en la notaría."*

### Resultado esperado

- Si se sube cédula → datos completos extraídos por OCR
- Si NO se sube cédula → persona aparece con nombre/CC del certificado pero demás campos vacíos
- El documento Word generado tiene líneas en blanco (`___________`) donde faltan datos
- El flujo nunca se bloquea por cédulas faltantes

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocumentUploadStep.tsx` | Reemplazar merge de personas del certificado por placeholders vacíos, actualizar texto de alerta |
| `supabase/functions/generate-document/index.ts` | Agregar instrucción de campos en blanco al prompt |

2 archivos.

