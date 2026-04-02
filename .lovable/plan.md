

## Plan: Reconciliación Multidocumento — `reconcileData.ts` + Escritura expandida

### Resumen

Crear el motor de cruce de datos entre documentos y expandir el OCR de escrituras para capturar estado civil y dirección desde la comparecencia. 6 archivos (1 nuevo).

### Cambios por archivo

**Archivo 1: `src/lib/reconcileData.ts`** (NUEVO)

Motor de reconciliación con 3 funciones principales:

- `normalizeCC(cc: string): string` — Elimina puntos, guiones, espacios y apóstrofes. El match SIEMPRE es por CC normalizada, nunca por nombre.

- `reconcilePersonas(formPersonas, certPersonas, cedulasDetail, escrituraComparecientes, dirtyFields) → { updated, alerts }`:
  1. Para cada persona en `formPersonas`, normaliza su CC
  2. Busca match en `cedulasDetail` por CC → enriquece `lugar_expedicion`
  3. Busca match en `escrituraComparecientes` por CC → enriquece `estado_civil`, `direccion`, `municipio_domicilio` (fuente de verdad para estos campos)
  4. Solo llena campos vacíos que NO estén en `dirtyFields`
  5. Si nombre del cert ≠ nombre de la cédula (normalizado sin tildes, uppercase): genera alerta de discrepancia

- `reconcileInmueble(inmueble, predialData, dirtyFields) → Inmueble`:
  - Si predial tiene `avaluo_catastral` y inmueble no → copiar
  - Si predial tiene `estrato` y inmueble no → copiar
  - Respeta dirty fields

- `normalizeNameForComparison(name): string` — Uppercase, sin tildes, trim. Solo para alertas, nunca como llave de match.

- Tipo `Alert = { tipo: "discrepancia" | "dato_faltante"; mensaje: string; campo?: string }`

**Archivo 2: `supabase/functions/scan-document/index.ts`**

Expandir `toolsByEscritura` → agregar al array `comparecientes`:
```
estado_civil: { type: "string", description: "Estado civil declarado en la comparecencia (soltero, casado, unión libre, etc.)" }
direccion: { type: "string", description: "Dirección de residencia declarada en la comparecencia" }
municipio_domicilio: { type: "string", description: "Municipio de domicilio declarado" }
```

Expandir `baseSystemPrompts.escritura_antecedente` para instruir buscar la sección de COMPARECENCIA y extraer estado civil, dirección y municipio de domicilio de cada compareciente. La escritura es la fuente de verdad para estos datos (no la cédula física).

**Archivo 3: `src/pages/Validacion.tsx`**

1. Importar `reconcilePersonas`, `reconcileInmueble` de `reconcileData.ts`
2. Al final de `loadTramite`, después de cargar personas, inmueble y actos:
   - Llamar `reconcilePersonas(vendedores, meta.extracted_personas, meta.extracted_cedulas_detail, meta.extracted_escritura_comparecientes, manuallyEditedFieldsRef.current)`
   - Actualizar `vendedores` y `compradores` con datos enriquecidos (solo campos vacíos y no dirty)
   - Mostrar alertas como toasts
   - Llamar `reconcileInmueble` para cruzar predial → inmueble
3. En `handleDocumentoExtracted`: si la escritura devuelve `comparecientes` con estado_civil/dirección, persistir como `extracted_escritura_comparecientes` en metadata

**Archivo 4: `src/components/tramites/InmuebleForm.tsx`**

En `handleScanDocument` para `escritura_antecedente`: si `d.comparecientes` existe con datos enriquecidos, emitirlos via `onDocumentoExtracted` callback ampliado para incluir `comparecientes`.

**Archivo 5: `src/components/tramites/DocxPreview.tsx`**

En `buildReplacements`:
- Aplicar `formatMonedaLegal` al `inmueble.avaluo_catastral` para formato notarial
- Aplicar `formatCedulaLegal` en los loops de personas para generar "79.681.841 expedida en Bogotá D.C."
- Aplicar `formatMonedaLegal` a todo valor económico: cuantía, hipoteca, avalúo, valor pagado

**Archivo 6: `src/components/tramites/DocumentUploadStep.tsx`**

En `handleContinue`, cuando el slot es `escritura_antecedente` y el resultado incluye `comparecientes`, guardar en `metadata.extracted_escritura_comparecientes`.

### Resumen

| Archivo | Cambio |
|---|---|
| `src/lib/reconcileData.ts` | NUEVO: normalizeCC, reconcilePersonas, reconcileInmueble, alerts |
| `supabase/functions/scan-document/index.ts` | +estado_civil, dirección, municipio en comparecientes escritura |
| `src/pages/Validacion.tsx` | Invocar reconciliación en loadTramite, persistir comparecientes |
| `src/components/tramites/InmuebleForm.tsx` | Emitir comparecientes enriquecidos desde escritura |
| `src/components/tramites/DocxPreview.tsx` | formatMonedaLegal en avalúo, formatCedulaLegal en personas |
| `src/components/tramites/DocumentUploadStep.tsx` | Persistir extracted_escritura_comparecientes |

6 archivos (1 nuevo). Sin migraciones DB.

