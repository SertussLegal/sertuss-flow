# Corrección quirúrgica: Segmentación de Inmueble + Linderos + Formato Notarial

## Hallazgos confirmados (auditoría vs ESCRITURA_2924.docx)

1. **`descripcion_predio` contaminada**: Gemini está metiendo área privada, área total, coeficiente de copropiedad y linderos en el campo "UBICACIÓN DEL PREDIO" del formulario de calificación SNR. Debe ser corto: solo identificación arquitectónica (apto, torre, conjunto).
2. **`nomenclatura_predio` duplica "(DIRECCION CATASTRAL)"**: aparece `... APARTAMENTO 1402 (DIRECCION CATASTRAL) (DIRECCION CATASTRAL) DE LA CIUDAD...`. El saneo actual existe pero no cubre el caso donde la dirección viene ya con sufijo Y además el backend re-inyecta otro.
3. **Linderos sin destino**: el cuerpo legal de la Cláusula Primera necesita los linderos completos (medidas, áreas, coeficiente), pero hoy no hay campo dedicado.
4. **Apoderado del Banco vacío**: aunque la UI ya tiene la sección, falta confirmar que la hidratación + nullGetter pinta `___________` cuando el poder no se cargó (imagen muestra campos en blanco sin las rayas).
5. **Notaría origen / fecha hipoteca**: ya vienen en formato doble (LETRAS + número), validado contra ESCRITURA_2924.

## 1. Backend — `supabase/functions/procesar-cancelacion/index.ts`

### 1.1 Tool schema (Gemini) — endurecer campos del inmueble

En `tools[0].function.parameters.properties.inmueble`:

- **`descripcion_predio`**: redefinir descripción → "Identificación arquitectónica del predio EXCLUSIVAMENTE en formato corto, en MAYÚSCULAS con números en letras + paréntesis. Ej: `APARTAMENTO NUMERO MIL CUATROCIENTOS DOS (1402) TORRE DOS (2) QUE HACE PARTE DEL CONJUNTO RESIDENCIAL SALITRE LIVING – PROPIEDAD HORIZONTAL`. PROHIBIDO incluir áreas (M2), coeficientes de copropiedad, linderos, puntos cardinales o medidas. Máx ~180 chars."
- **`nomenclatura_predio`**: "Dirección postal urbana LIMPIA y CORTA. Ej: `CALLE 66 C NUMERO 60-65`. PROHIBIDO incluir ciudad, sufijo `(DIRECCION CATASTRAL)`, apartamento ni torre."
- **Nuevo `linderos_detallados`** (opcional): "Bloque completo de linderos técnicos, medidas en metros, áreas privada/construida/total y coeficiente de copropiedad, copiado textualmente de la escritura de constitución de hipoteca. Va al cuerpo de la Cláusula Primera. Mantén MAYÚSCULAS y el formato `LETRAS (NUMERO)`."

Actualizar también `SYSTEM_PROMPT` con estas reglas y un ejemplo negativo: "NO escribas `APARTAMENTO 1402 ... CON UN ÁREA PRIVADA DE 26.50 M2 ...` en `descripcion_predio`; eso va en `linderos_detallados`."

### 1.2 Interface `CancelacionData.inmueble`

Agregar `linderos_detallados?: string;`.

### 1.3 `buildDocxVars` — mapeo determinista

- **`descripcion_predio`**: pasar tal cual (Gemini ya devuelve limpio).
- **`nomenclatura_predio`**: reforzar saneo para colapsar TODO sufijo catastral y luego inyectarlo UNA sola vez junto con la ciudad:
  ```
  nomenclaturaBase = nomenclaturaBase
    .replace(/\(?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*\)?/gi, "")
    .replace(/\s+/g, " ").trim();
  const nomenclaturaFinal = nomenclaturaBase
    ? `${nomenclaturaBase} (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE ${ciudadInmueble}`
    : undefined;
  ```
- **Nuevo `linderos_inmueble`**: mapea `data.inmueble.linderos_detallados`. Si falta → nullGetter dejará rayas. Este tag entra al cuerpo de la Cláusula Primera del template.

### 1.4 Modo `regen`

Confirmar que `data.inmueble.linderos_detallados` viaja en `data_final` y se re-mapea (ya cubre, porque pasa todo el objeto).

## 2. Frontend — `src/pages/CancelacionValidar.tsx`

En la `<Section title="Inmueble">`:

1. Mantener Matrícula + Ciudad.
2. Mantener `descripcion_predio` (Textarea 2 filas) — **cambiar helper text**: "Solo identificación arquitectónica (apto, torre, conjunto). No incluir áreas ni linderos."
3. Mantener `nomenclatura_predio` (Input) — el sistema ya añade `(DIRECCION CATASTRAL) DE LA CIUDAD…`.
4. **Nuevo Textarea (5–7 filas) `linderos_detallados`** con label "Linderos, Medidas y Áreas Detalladas (Cuerpo de la Escritura)" y helper "Bloque largo de linderos técnicos, áreas y coeficiente de copropiedad. Aparece en la Cláusula Primera."
5. Actualizar el tipo `Data.inmueble` para incluir `linderos_detallados?: string`.
6. Conectado al autosave 15s existente (sin tocar el debounce).

## 3. Plantillas .docx en bucket

**Nota importante**: las plantillas activas en `cancelaciones-plantillas/davivienda/*.docx` ya tienen los placeholders. Para que `{linderos_inmueble}` aparezca en la Cláusula Primera de la minuta, las plantillas deben actualizarse manualmente con ese tag. Esto se hace una sola vez en el bucket — no es parte del despliegue de código. **Confirmar con el usuario** si quiere que en este turno solo deje el backend/UI listos (esperando a que él suba la plantilla parcheada), o si prefiere que generemos un script de parche.

## 4. Despliegue

`supabase--deploy_edge_functions(["procesar-cancelacion"])` tras los cambios de backend.

## 5. QA con los 3 PDFs reales (post-deploy)

1. Subir `50C-2232960.pdf` + `05700007700918458_Escritura.pdf` (sin poder).
2. Verificar en la UI:
   - "UBICACIÓN DEL PREDIO" = solo `APARTAMENTO 1402 TORRE 2 DEL CONJUNTO RESIDENCIAL SALITRE LIVING – PROPIEDAD HORIZONTAL`.
   - "NOMBRE O DIRECCIÓN" = `CALLE 66 C NUMERO 60-65 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C.` (UN solo sufijo).
   - Nueva caja de linderos prellena con áreas + coeficiente + puntos 1-2, 2-3, etc.
   - Apoderado en blanco → docx muestra `___________` en cédula, escritura, fecha y notaría del poder.
3. Descargar la minuta y validar contra `ESCRITURA_2924.docx`.

## Pregunta de bloqueo

¿Procedo asumiendo que TÚ (o Alejandra) actualizarás manualmente las dos plantillas `.docx` en el bucket `cancelaciones-plantillas/davivienda/` para reemplazar el placeholder de linderos actual por `{linderos_inmueble}` en la Cláusula Primera? O ¿prefieres que prepare un script de parche `pizzip` que lo haga programáticamente?
