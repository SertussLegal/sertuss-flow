

## Plan: Implementar las 4 recomendaciones del análisis de gaps — Enfoque profesional

### Resumen ejecutivo

Hay **35 placeholders vacíos** en la plantilla. Se resuelven con 3 cambios coordinados: expandir OCR, expandir formularios, y conectar datos al preview. Sin cambios destructivos.

### Prioridad 1 — Expandir OCR del poder bancario (cierra 10 gaps)

**Problema**: `extract_poder_banco` solo extrae 3 campos (nombre, cédula, entidad). La plantilla necesita 12 campos del apoderado (escritura del poder, fecha, notaría, ciudad, expedida_en).

**Implementación**:
- **`supabase/functions/scan-document/index.ts`**: Expandir `toolsByPoderBanco` para agregar 9 campos nuevos al schema de tool calling:
  - `expedida_en` (lugar expedición cédula del apoderado)
  - `escritura_poder_num` (número de escritura del poder)
  - `fecha_poder` (fecha del poder DD-MM-AAAA)
  - `notaria_poder` (nombre/número de la notaría donde se otorgó el poder)
  - `notaria_poder_ciudad` (ciudad de la notaría del poder)
  - `email_apoderado` (correo del apoderado, si aparece)

  Gemini ya recibe el documento completo — solo hay que pedirle los campos adicionales en el schema. No cambia el prompt significativamente.

- **`src/components/tramites/ActosForm.tsx`**: Agregar los campos nuevos al `applyOcrResults` en el handler de `poder_banco`, y crear inputs para los nuevos campos en la sección de hipoteca.

- **`src/lib/types.ts`**: Agregar campos opcionales a `Actos`:
  ```
  apoderado_expedida_en?: string
  apoderado_escritura_poder?: string
  apoderado_fecha_poder?: string
  apoderado_notaria_poder?: string
  apoderado_notaria_ciudad?: string
  apoderado_email?: string
  ```

- **`src/components/tramites/DocxPreview.tsx`**: Reemplazar los `"___________"` hardcoded de `apoderado_banco.*` con los datos reales del `actos` expandido. Parsear `fecha_poder` para derivar `poder_dia_letras`, `poder_mes`, `poder_anio_num`, etc.

- **DB migration**: Agregar columnas opcionales a la tabla `actos`:
  ```sql
  ALTER TABLE actos ADD COLUMN apoderado_expedida_en text DEFAULT '';
  ALTER TABLE actos ADD COLUMN apoderado_escritura_poder text DEFAULT '';
  ALTER TABLE actos ADD COLUMN apoderado_fecha_poder text DEFAULT '';
  ALTER TABLE actos ADD COLUMN apoderado_notaria_poder text DEFAULT '';
  ALTER TABLE actos ADD COLUMN apoderado_notaria_ciudad text DEFAULT '';
  ALTER TABLE actos ADD COLUMN apoderado_email text DEFAULT '';
  ```

### Prioridad 2 — Expandir formulario de Actos (cierra 9 gaps)

**Problema**: Los campos financieros detallados (pago inicial, saldo financiado, fecha del crédito) no existen en el modelo ni en el formulario.

**Implementación**:
- **`src/lib/types.ts`**: Agregar a `Actos`:
  ```
  pago_inicial?: string
  saldo_financiado?: string
  fecha_credito?: string
  ```

- **`src/components/tramites/ActosForm.tsx`**: Agregar 3 inputs en la sección de hipoteca (pago inicial, saldo financiado, fecha del crédito). El saldo financiado se puede auto-calcular como `valor_compraventa - pago_inicial`.

- **`src/components/tramites/DocxPreview.tsx`**: Mapear los nuevos campos a los placeholders con conversión automática número→letras:
  - `actos.pago_inicial_numero` → `actos.pago_inicial`
  - `actos.pago_inicial_letras` → `numberToWords(actos.pago_inicial)`
  - `actos.saldo_financiado_*` → igual
  - `actos.credito_dia_*`, `actos.credito_mes`, `actos.credito_anio_*` → parseando `fecha_credito`

- **DB migration**: 
  ```sql
  ALTER TABLE actos ADD COLUMN pago_inicial text DEFAULT '';
  ALTER TABLE actos ADD COLUMN saldo_financiado text DEFAULT '';
  ALTER TABLE actos ADD COLUMN fecha_credito text DEFAULT '';
  ```

### Prioridad 3 — Expandir OCR del predial (cierra 3 gaps)

**Problema**: `extract_predial` solo extrae 4 campos. Falta número de recibo, año y valor pagado.

**Implementación**:
- **`supabase/functions/scan-document/index.ts`**: Agregar a `toolsByPredial`:
  - `numero_recibo` (número del recibo de pago)
  - `anio_gravable` (año del impuesto)
  - `valor_pagado` (valor pagado)
  - `estrato` (estrato socioeconómico)

- **`src/components/tramites/DocxPreview.tsx`**: Conectar los datos (llegarán via metadata) a:
  - `inmueble.predial_num` → `numero_recibo`
  - `inmueble.predial_anio` → `anio_gravable`
  - `inmueble.predial_valor` → `valor_pagado`
  - `inmueble.estrato` → `estrato`

- **`src/pages/Validacion.tsx`**: Leer `metadata.extracted_predial` y pasarlo como prop o mergearlo al inmueble.

### Prioridad 4 — Campos que NO son de OCR (matrícula matriz, NIT banco)

**Problema**: `rph.matricula_matriz`, `actos.entidad_nit`, `actos.entidad_domicilio` requieren datos que no están en documentos escaneados.

**Implementación**:
- **`src/components/tramites/InmuebleForm.tsx`**: Agregar campo `matricula_matriz` en la sección de propiedad horizontal.
- **`src/components/tramites/ActosForm.tsx`**: Agregar campos `NIT del banco` y `domicilio del banco` en la sección de hipoteca (opcionales, el usuario puede llenarlos manualmente o se podría usar un lookup futuro).
- **`src/lib/types.ts`**: Agregar `matricula_matriz?: string` a `Inmueble`.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `supabase/functions/scan-document/index.ts` | Expandir schemas de `poder_banco` (+6 campos) y `predial` (+4 campos) |
| `src/lib/types.ts` | Agregar ~12 campos opcionales a `Actos`, `matricula_matriz` a `Inmueble` |
| `src/components/tramites/ActosForm.tsx` | Agregar inputs para pago inicial, saldo financiado, fecha crédito, campos apoderado expandidos, NIT/domicilio banco |
| `src/components/tramites/InmuebleForm.tsx` | Agregar campo matrícula matriz en sección PH |
| `src/components/tramites/DocxPreview.tsx` | Conectar ~30 placeholders con datos reales en vez de `"___________"` hardcoded |
| `src/pages/Validacion.tsx` | Leer `extracted_predial` de metadata, pasar datos a DocxPreview |

6 archivos + 2 migraciones de DB (columnas nuevas en `actos` e `inmuebles`).

### Resultado esperado

De los 35 gaps actuales:
- **10** se cierran con OCR del poder bancario expandido
- **9** se cierran con el formulario de actos expandido
- **3** se cierran con OCR del predial expandido
- **3** se cierran con campos manuales (matrícula matriz, NIT/domicilio banco)
- **10** restantes dependen de datos generados al momento de protocolización (`escritura_numero`, `fecha_escritura_corta`, `actos.redam_resultado`) o de documentos adicionales (IDU, administración) — se dejan como `___________` con un indicador visual claro.

Total: **25 de 35 gaps cerrados** en esta iteración.

