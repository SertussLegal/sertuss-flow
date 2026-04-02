

## Plan: Corregir `[object Object]`, vendedores extra, y agregar UX de cédulas faltantes

### Problemas raíz

1. **`[object Object]` en campos de persona**: En `DocumentUploadStep.tsx` líneas 248-251, los campos del scan-document (`nombre_completo`, `numero_cedula`) vienen como objetos `{valor: "...", confianza: "alta"}` pero se almacenan sin hacer unwrap. Luego en `Validacion.tsx` línea 204, `p.nombre_completo` sigue siendo un objeto → `[object Object]`.

2. **Vendedores extra no solicitados**: Líneas 308-330 de `DocumentUploadStep.tsx` agregan placeholders de propietarios del certificado de tradición como vendedores, incluso si el usuario solo cargó una cédula. Esto causa que aparezcan vendedores adicionales que el usuario nunca pidió.

3. **Sin UX para cédulas faltantes/ilegibles**: En el paso 2 (Validacion), no hay indicador visual cuando no se cargaron cédulas o cuando no se pudieron leer.

### Cambios

**`src/components/tramites/DocumentUploadStep.tsx`**:
- Líneas 248-255: Usar `unwrapConfianza` para extraer `.valor` de `nombre_completo`, `numero_cedula`, y `lugar_expedicion` antes de almacenarlos en `extractedPersonas`. Importar `unwrapConfianza` del types.
- Líneas 308-330: Eliminar la lógica que agrega placeholders de propietarios del certificado como vendedores extra. Los propietarios del certificado son solo informacionales — no deben crear formularios automáticos.

**`src/pages/Validacion.tsx`**:
- Líneas 202-208: Agregar protección para que si `p.nombre_completo` o `p.numero_identificacion` son objetos `{valor, confianza}`, se extraiga el `.valor`. Esto cubre datos ya guardados en la BD con el bug anterior.

**`src/components/tramites/PersonaForm.tsx`**:
- Agregar estado visual cuando la persona tiene campos vacíos (no se cargó cédula o no se pudo leer):
  - Si `nombre_completo` y `numero_cedula` están ambos vacíos: mostrar un banner "No se cargó cédula. Cárguela aquí" con botón de upload
  - Si solo se ven datos parciales/vacíos tras un scan: ya existe el botón "Cargar Cédula" en cada persona, se mantiene
  - Estos son informativos, no bloqueantes

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocumentUploadStep.tsx` | Unwrap `{valor, confianza}` en persona slots; eliminar placeholders de certificado |
| `src/pages/Validacion.tsx` | Protección de unwrap en loadTramite para datos legacy |
| `src/components/tramites/PersonaForm.tsx` | Banner informativo cuando persona no tiene datos de cédula |

3 archivos.

