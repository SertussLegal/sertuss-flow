

## Auditoría: Flujo OCR → Datos de Notaría — Estado Actual

### Resultado: El pipeline ya funciona correctamente sin el selector de notaría

La extracción OCR de datos notariales es **independiente** del selector de notaría en la UI. Son dos flujos separados:

### Flujo 1: OCR (extracción de datos — siempre activo)
- `scan-document` extrae de **cada documento** los datos de notaría:
  - **Certificado de Tradición**: `notaria_origen`, `numero_escritura`, `fecha_documento`
  - **Escritura Antecedente**: `notaria`, `ciudad_notaria`, `comparecientes[]` (con estado civil, dirección, municipio)
  - **Título Antecedente**: `notaria_documento`, `ciudad_documento`
- Estos datos se guardan en `metadata.extracted_documento` y `metadata.extracted_escritura_comparecientes`
- Se usan directamente en el template DOCX: `notaria_previa_numero`, `notaria_previa_circulo`, etc.

### Flujo 2: Selector de Notaría (preferencias de estilo — opcional)
- Solo afecta **formato de redacción**: estilo de linderos, márgenes, cláusulas personalizadas
- Si no hay notaría configurada, `process-expediente` funciona sin ella (línea 45: `estiloNotaria` puede ser `null`)
- El prompt SERTUSS-EDITOR-PRO aplica estilo genérico si no hay config

### Conclusión: No se requieren cambios

Los datos legales (notaría de origen, título antecedente, comparecientes) se extraen del OCR y fluyen al template independientemente del selector. El selector de notaría solo controla preferencias estéticas de redacción. **Ocultar el selector no afecta la extracción ni la redacción legal.**

No hay archivos que modificar.

