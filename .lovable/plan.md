# Cancelaciones Davivienda — Segmentación estricta de Inmueble (sin linderos)

Regla específica de esta sección (NO aplica a Escrituras): la cancelación no necesita ni debe transportar linderos técnicos, medidas ni coeficientes. La Cláusula Primera de `ESCRITURA_2924.docx` solo remite al cuadro superior. Toda extracción adicional se descarta en origen.

## Hallazgos confirmados

1. `descripcion_predio` viene contaminada con áreas (26.50 M2 / 30.00 M2), coeficiente (0.069220%) y linderos (puntos 1-2, 2-3, …) — debe ser un único renglón arquitectónico.
2. `nomenclatura_predio` aparece con `(DIRECCION CATASTRAL) (DIRECCION CATASTRAL)` duplicado por convivencia de sufijo del OCR + inyección del backend.
3. Apoderado: la sección colapsable existe; queda confirmar que el aviso ámbar aparece cuando no hay poder y que el nullGetter pinta `___________` en la antefirma.

## 1. Backend — `supabase/functions/procesar-cancelacion/index.ts`

### 1.1 Tool schema (Gemini)

En `tools[0].function.parameters.properties.inmueble`:

- `descripcion_predio` (description): "Identificación arquitectónica del predio en formato notarial corto, MAYÚSCULAS, con números en LETRAS seguidos del número entre paréntesis. Ej exacto: `APARTAMENTO NUMERO MIL CUATROCIENTOS DOS (1402) TORRE DOS (2) QUE HACE PARTE DEL CONJUNTO RESIDENCIAL SALITRE LIVING – PROPIEDAD HORIZONTAL`. PROHIBIDO incluir áreas privadas/construidas/totales, metros cuadrados, coeficiente de copropiedad, linderos, puntos cardinales, dimensiones ni nomenclatura urbana. Si encuentras ese contenido en la escritura, descártalo."
- `nomenclatura_predio` (description): "Dirección postal urbana del predio en formato notarial, MAYÚSCULAS. Ej exacto: `CALLE 66 C NUMERO 60-65`. PROHIBIDO incluir apartamento/torre, ciudad, ni el sufijo `(DIRECCION CATASTRAL)` — el backend los agrega."
- (No se agrega `linderos_detallados`.)

### 1.2 `SYSTEM_PROMPT`

Agregar bloque "REGLAS DE INMUEBLE PARA CANCELACIÓN":
- Ejemplo positivo y negativo de `descripcion_predio` (mostrar el caso contaminado actual como anti-ejemplo).
- Ejemplo positivo y negativo de `nomenclatura_predio` (sin sufijo catastral, sin ciudad).
- "Ignora linderos, áreas y coeficientes aunque aparezcan en los PDFs; no son requeridos para esta cancelación."

### 1.3 `buildDocxVars` — endurecer saneo

En el bloque de Inmueble:

```ts
// 1) Descripción: forzar single-line y truncar si Gemini se desbordó.
const descripcionPredio = (data.inmueble.descripcion_predio ?? data.inmueble.descripcion ?? "")
  .replace(/\s+/g, " ")
  .trim();

// 2) Nomenclatura: colapsar TODOS los sufijos catastrales y la ciudad redundante.
let nomenclaturaBase = (data.inmueble.nomenclatura_predio ?? data.inmueble.direccion_completa ?? "").trim();
nomenclaturaBase = nomenclaturaBase
  .replace(/\(?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*\)?/gi, "")
  .replace(/\s+DE\s+LA\s+CIUDAD\s+Y\/O\s+MUNICIPIO\s+DE\s+.+$/i, "")
  .replace(/\s+/g, " ")
  .trim();

const ciudadInmueble = (data.inmueble.ciudad || "").trim();
const nomenclaturaFinal = nomenclaturaBase
  ? `${nomenclaturaBase} (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE ${ciudadInmueble}`.trim()
  : undefined;
```

Esto deja `{descripcion_predio}` y `{nomenclatura_predio}` listos sin duplicados, con un solo sufijo `(DIRECCION CATASTRAL)` añadido por el código.

## 2. Frontend — `src/pages/CancelacionValidar.tsx`

Sección "Inmueble" queda exactamente con 4 campos en este orden:
1. **Matrícula** (Input)
2. **Ciudad** (Input)
3. **Descripción Arquitectónica del Predio (Ubicación)** (Textarea, 2 filas) — helper: "Solo identificación arquitectónica (apartamento, torre, conjunto). No incluir áreas, coeficientes ni linderos."
4. **Nomenclatura Urbana (Dirección)** (Input) — helper actual sobre el sufijo catastral.

No se agregan otros campos. Se elimina del tipo `Data.inmueble` cualquier referencia a linderos detallados (no existe hoy, se confirma que no se introduce).

## 3. Despliegue

`supabase--deploy_edge_functions(["procesar-cancelacion"])`.

## 4. QA con los 3 PDFs reales

1. Volver a procesar `50C-2232960.pdf` + `05700007700918458_Escritura.pdf` (sin poder).
2. Validar:
   - "Descripción Arquitectónica" = `APARTAMENTO NUMERO MIL CUATROCIENTOS DOS (1402) TORRE DOS (2) QUE HACE PARTE DEL CONJUNTO RESIDENCIAL SALITRE LIVING – PROPIEDAD HORIZONTAL` (sin M2, sin coeficiente, sin puntos).
   - "Nomenclatura" = `CALLE 66 C NUMERO 60-65`.
   - Docx descargado muestra UN solo `(DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C.`.
   - Sección Apoderado del Banco muestra alerta ámbar y antefirma con `___________`.
3. Repetir el caso adjuntando el Poder y verificar que la antefirma se rellena.

## 5. Memoria del proyecto

Tras el deploy, añadir memoria `mem://features/cancelaciones-reglas-inmueble` documentando: Cancelaciones Davivienda nunca extraen ni almacenan linderos/áreas/coeficientes; sólo identificación arquitectónica + nomenclatura urbana. Aclarar que esto NO aplica a Escrituras (donde sí se requieren).
