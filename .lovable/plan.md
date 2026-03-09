

## Análisis: Nuevas funcionalidades de carga documental con OCR

### Estado actual

| Documento | Edge function | Formulario | Campos que extrae |
|-----------|:---:|:---:|---|
| Cédula de ciudadanía | `cedula` | PersonaForm | nombre, cédula, municipio expedición |
| Certificado de tradición | `certificado_tradicion` | InmuebleForm | matrícula, ORIP, dirección, municipio, depto, linderos, área |
| Paz y salvo predial | `predial` (existe en backend) | **No conectado** | identificador predial, avalúo catastral |

### Funcionalidades nuevas a implementar

**1. Cargar Paz y Salvo Predial** (InmuebleForm)
- El backend ya tiene el tool `extract_predial` definido. Solo falta el botón de carga en el formulario.
- Extrae: cédula catastral (identificador_predial) + avalúo catastral + área + dirección.
- Segundo botón junto al de "Cargar Certificado".
- Complejidad: baja — backend listo, solo UI.

**2. Cargar Escritura Antecedente** (InmuebleForm)
- Nuevo tipo en el edge function: `escritura_antecedente`.
- Extrae: linderos especiales del inmueble. Si PH, también linderos generales.
- Nuevo tool calling con campos: `linderos_especiales`, `linderos_generales` (opcional).
- Al recibir datos, concatenar ambos en el campo `linderos` del formulario.
- Tercer botón de carga en InmuebleForm.
- Complejidad: media — requiere nuevo tool en backend + UI.

**3. Extraer datos de PH del Certificado de Tradición** (InmuebleForm)
- El scan de certificado ya existe, pero no extrae escrituras de constitución ni reformas PH.
- Ampliar el tool `extract_certificado_tradicion` para incluir: `escritura_constitucion_ph`, `reformas_ph`, `tipo_predio`.
- Si el certificado contiene PH, activar el toggle automáticamente y poblar los campos.
- Complejidad: baja — ampliar tool existente + mapeo en UI.

**4. Cargar Poder del Banco + Carta de Crédito** (ActosForm)
- Nuevo tipo en edge function: `poder_banco`.
- Extrae: nombre apoderado banco, cédula apoderado, entidad bancaria.
- Otro tipo: `carta_credito` → extrae valor del crédito hipotecario.
- Se podrían unificar en un solo tipo `documentos_hipoteca` que acepte cualquiera de los dos.
- Dos botones de carga en la sección de hipoteca de ActosForm.
- Complejidad: media — nuevo tool en backend + UI con lógica condicional (solo visible si es hipoteca).

### Resumen de cambios por archivo

| Archivo | Cambios |
|---------|---------|
| `scan-document/index.ts` | Agregar tools: `escritura_antecedente`, `poder_banco`. Ampliar `certificado_tradicion` con campos PH. |
| `InmuebleForm.tsx` | Agregar botón "Cargar Paz y Salvo" (ya tiene backend). Agregar botón "Cargar Escritura Antecedente". Auto-activar PH si certificado lo detecta. |
| `ActosForm.tsx` | Agregar botones "Cargar Poder del Banco" y "Cargar Carta de Crédito" dentro de la sección hipoteca. |
| `supabase/config.toml` | Sin cambios (función ya existe). |

### Orden recomendado de implementación

1. **Paz y salvo** — el backend ya está listo, es solo conectar el botón.
2. **Ampliar certificado con PH** — bajo esfuerzo, alto valor.
3. **Escritura antecedente** — nuevo tool, impacto directo en linderos.
4. **Documentos de hipoteca** — nuevo tool, condicional a tipo de acto.

### Consideraciones

- Cada carga de documento consume 1 crédito (patrón ya establecido).
- Los documentos pueden ser imágenes o PDF (el `accept` ya maneja ambos en InmuebleForm; en ActosForm se debe agregar).
- El modelo Gemini 2.5 Flash ya se usa para OCR multimodal y funciona bien con documentos legales colombianos.

