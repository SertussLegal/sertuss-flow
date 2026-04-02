

## Plan: Motor de Razonamiento Jurídico — 4 Capas de Inteligencia Legal

### Diagnóstico

El sistema actual es un "extractor de texto" que copia campos sin contexto jurídico. Hay 4 brechas fundamentales:

1. **Sin inferencia de hechos jurídicos**: El OCR no deduce que si dice "Régimen de Propiedad Horizontal" → el inmueble es URBANO_PH y debe buscar coeficiente + matrícula matriz
2. **Sin cadena de tradición**: No extrae el título antecedente (cómo el vendedor adquirió el bien) — dato obligatorio en toda escritura notarial
3. **Sin normalización legal**: Los montos se muestran como números planos, no en formato notarial ("CIENTO CINCUENTA MILLONES DE PESOS M/CTE ($150.000.000)")
4. **Sin validación cruzada**: Si el certificado dice "JOHN MAYA" pero la cédula cargada es de "PEDRO LÓPEZ", el sistema no alerta

### Cambios por archivo

**Archivo 1: `supabase/functions/scan-document/index.ts`** — Motor de inferencia en el prompt + schema expandido

- Expandir el schema `toolsByCertificado` con un nodo `titulo_antecedente`:
```
titulo_antecedente: {
  tipo_documento: "Escritura Pública / Sentencia Judicial / Resolución",
  numero_documento: "Número del documento",
  fecha_documento: "Fecha DD-MM-AAAA",
  notaria_documento: "Notaría donde se otorgó",
  ciudad_documento: "Ciudad de la notaría",
  adquirido_de: "Nombre de quien transfirió el bien al actual propietario"
}
```
- Expandir el prompt del certificado con instrucciones de **inferencia jurídica**:
  - "Si detectas 'Régimen de Propiedad Horizontal' o 'PH', marca `es_propiedad_horizontal: true` y busca OBLIGATORIAMENTE: nombre del conjunto/edificio, coeficiente de copropiedad, matrícula matriz, escritura de constitución PH con fecha/notaría/ciudad"
  - "Identifica el TÍTULO ANTECEDENTE: busca la anotación que dio origen a la propiedad actual del vendedor. Extrae tipo de documento, número, fecha, notaría y ciudad"
  - "Asigna ROLES semánticos: si una persona aparece como 'DE:' en una compraventa, es vendedor previo. Si aparece como 'A FAVOR DE:', es el comprador/propietario actual"
- Agregar campos PH estructurados al nodo `inmueble`: `nombre_conjunto_edificio`, `escritura_ph_numero`, `escritura_ph_fecha`, `escritura_ph_notaria`, `escritura_ph_ciudad`, `coeficiente_copropiedad`
- Expandir `toolsByEscritura` para extraer más que solo linderos: agregar `numero_escritura`, `fecha`, `notaria`, `ciudad`, `tipo_acto`, `comparecientes` (nombre+cédula+rol)

**Archivo 2: `src/lib/types.ts`** — Tipos expandidos

- Agregar a `Inmueble`: `nombre_edificio_conjunto?: string`, `escritura_ph_numero?: string`, `escritura_ph_fecha?: string`, `escritura_ph_notaria?: string`, `escritura_ph_ciudad?: string`, `coeficiente_copropiedad?: string`
- Agregar a `ExtractedDocumento` (en DocxPreview): `titulo_antecedente` con sus subcampos
- Actualizar `createEmptyInmueble()` con defaults vacíos para los nuevos campos

**Archivo 3: `src/lib/legalFormatters.ts`** (nuevo) — Capa de formateo legal

- `formatMonedaLegal(valor: string): string` — Convierte "150000000" → "CIENTO CINCUENTA MILLONES DE PESOS M/CTE ($150.000.000,00)". Usa el `numberToWords` existente + formateo con puntos de miles
- `formatFechaLegal(fecha: string): string` — Convierte "02-02-2018" → "dos (2) de febrero de dos mil dieciocho (2018)". Día y año en letras y números
- `formatCedulaLegal(cedula: string, expedicion?: string): string` — "79.681.841 expedida en Bogotá D.C."

**Archivo 4: `src/pages/Validacion.tsx`** — Distribución de título antecedente + validación cruzada

- En `loadTramite`: leer `meta.extracted_titulo_antecedente` y pasarlo a `extractedDocumento` (ampliar el estado con los nuevos campos)
- **Validación cruzada**: después de cargar personas del certificado y personas de cédulas, comparar nombres+cédulas. Si hay discrepancia, mostrar un toast de alerta:
```typescript
// Cross-check: cert says owner is "JOHN MAYA CC 79681841"
// but cedula scan returned "PEDRO LOPEZ CC 12345678"
// → Alert: "Discrepancia detectada: el certificado indica propietario JOHN MAYA pero la cédula cargada es de PEDRO LOPEZ"
```
- Pasar `titulo_antecedente` como parte de `extractedDocumento` al DocxPreview
- En `handleActosExtracted`: si viene `titulo_antecedente`, guardarlo en metadata

**Archivo 5: `src/components/tramites/InmuebleForm.tsx`** — Mapeo de campos PH estructurados

- En `handleScanDocument` para certificado: mapear los nuevos campos PH del OCR (`nombre_conjunto_edificio`, `escritura_ph_numero`, etc.) al estado `inmueble`
- Emitir `titulo_antecedente` como parte del callback `onDocumentoExtracted`

**Archivo 6: `src/components/tramites/DocxPreview.tsx`** — Formateo legal + placeholders antecedentes

- Importar `formatMonedaLegal`, `formatFechaLegal` de `legalFormatters`
- En `buildReplacements`:
  - Usar `formatMonedaLegal` para `actos.cuantia_compraventa_letras`, `actos.cuantia_hipoteca_letras` (en vez del `numberToWords` raw)
  - Agregar placeholders de título antecedente: `antecedentes.titulo_tipo`, `antecedentes.titulo_numero`, `antecedentes.titulo_fecha_dia/mes/anio`, `antecedentes.titulo_notaria`, `antecedentes.titulo_ciudad`, `antecedentes.adquirido_de`
  - Usar campos PH estructurados (`escritura_ph_numero`, `escritura_ph_fecha`, etc.) como fuente primaria para los placeholders RPH, con fallback al parseo del string `escritura_ph`
  - Aplicar `formatFechaLegal` para fechas en la previsualización donde corresponda

**Archivo 7: `src/components/tramites/DocumentUploadStep.tsx`** — Persistir título antecedente

- En `handleContinue`: si el resultado del certificado incluye `titulo_antecedente`, guardarlo en `metadata.extracted_titulo_antecedente`

### Resumen

| Archivo | Cambio |
|---|---|
| `supabase/functions/scan-document/index.ts` | +nodo `titulo_antecedente`, +7 campos PH estructurados, prompt con inferencia jurídica |
| `src/lib/types.ts` | +6 campos PH en Inmueble |
| `src/lib/legalFormatters.ts` | Nuevo: `formatMonedaLegal`, `formatFechaLegal`, `formatCedulaLegal` |
| `src/pages/Validacion.tsx` | Distribución título antecedente, validación cruzada personas cert↔cédula |
| `src/components/tramites/InmuebleForm.tsx` | Mapeo campos PH estructurados + título antecedente |
| `src/components/tramites/DocxPreview.tsx` | Formateo legal en montos/fechas, placeholders título antecedente, PH estructurado |
| `src/components/tramites/DocumentUploadStep.tsx` | Persistir `extracted_titulo_antecedente` |

7 archivos (1 nuevo). Sin migraciones DB.

