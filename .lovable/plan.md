

## Plan v2.0 — Edición Blindada: Extracción de Actos desde Certificado + Reactividad Atómica

### Diagnóstico crítico del plan original

Audité los 6 archivos del pipeline completo. El plan original tiene **4 puntos débiles**:

**1. Stale State en handleActosExtracted**: El `useCallback` con deps vacías (`[]`) es correcto porque solo usa setters (estables). Sin embargo, la guarda `!prev.tipo_acto` es insuficiente: si el OCR del certificado termina 30s después de que el usuario seleccionó manualmente "Compraventa" en el dropdown, el OCR no debe sobrescribirlo. El plan necesita un **dirty fields tracker** por campo individual, no solo por objeto.

**2. Esquema asume un solo acto**: Un certificado de tradición real puede contener: Compraventa + Hipoteca + Afectación a vivienda familiar + Cancelación de hipoteca anterior. El esquema `actos` propuesto es plano y solo captura un acto. Necesitamos un `acto_principal` (el de mayor cuantía o el más reciente) más un array de `actos_secundarios` para referencia.

**3. El DocxPreview ya es reactivo**: La previsualización YA se actualiza en tiempo real sin "Guardar" — el `useEffect` con debounce de 500ms en línea 586-646 escucha `buildReplacements` (que depende de `inmueble`, `actos`, etc.). El plan original no necesita agregar reactividad, pero SÍ necesita asegurar que los nuevos campos de actos lleguen al `buildReplacements`.

**4. Moneda asumida COP**: El esquema no especifica moneda. En el 99.9% de casos es COP, pero se debe normalizar el string (`$450.000.000,00` → `450000000`) antes de guardarlo en estado.

### Mejoras proactivas integradas

#### A. Dirty Fields Tracker (Prevención de sobreescritura)

Agregar un `Set<string>` llamado `manuallyEditedFields` en `Validacion.tsx`. Cada vez que el usuario edita un campo manualmente (via `handleFieldEdit`, `update()` en formularios, o dropdown changes), el campo se registra como "dirty". Los handlers OCR (`handleActosExtracted`, etc.) verifican este set antes de escribir:

```typescript
const manuallyEditedFieldsRef = useRef<Set<string>>(new Set());

// En handleFieldEdit:
manuallyEditedFieldsRef.current.add(field);

// En handleActosExtracted:
if (extracted.tipo_acto && !manuallyEditedFieldsRef.current.has("tipo_acto") && !prev.tipo_acto)
  updates.tipo_acto = extracted.tipo_acto;
```

#### B. Lista blanca de entidades bancarias (Enriquecimiento semántico)

Diccionario interno hardcodeado en DocxPreview o en un helper:

```typescript
const ENTIDADES_BANCARIAS: Record<string, { nit: string; domicilio: string }> = {
  "BANCO DE BOGOTA": { nit: "860.002.964-4", domicilio: "Bogotá D.C." },
  "BANCOLOMBIA": { nit: "890.903.938-8", domicilio: "Medellín" },
  "DAVIVIENDA": { nit: "860.034.313-7", domicilio: "Bogotá D.C." },
  "BBVA COLOMBIA": { nit: "860.003.020-1", domicilio: "Bogotá D.C." },
  // ... ~15 bancos principales
};
```

Cuando el OCR devuelve `entidad_bancaria: "BANCO DE BOGOTA"` pero `entidad_nit` está vacío, autocompletar NIT y domicilio desde la lista blanca.

#### C. Normalización monetaria

Helper `cleanCurrency`:
```typescript
const cleanCurrency = (val: string): string => {
  if (!val) return "";
  return val.replace(/[$.\s]/g, "").replace(/,\d{2}$/, "").replace(/,/g, "");
};
```
Aplicar al guardar `valor_compraventa` y `valor_hipoteca` en `handleActosExtracted`.

#### D. Verificación visual OCR ↔ formulario

En `buildReplacements`, para campos que tienen valor Y coinciden con el dato OCR original, usar un estilo diferente (check verde). Los campos que el usuario cambió manualmente se muestran en azul (editado). Esto requiere comparar el valor actual con `extractedPredial`/`extractedDocumento`.

### Cambios por archivo

**Archivo 1: `supabase/functions/scan-document/index.ts`**

Expandir `toolsByCertificado` con un nodo `actos`:
```
actos: {
  type: "object",
  properties: {
    tipo_acto_principal: confField("Acto principal: Compraventa, Donación, etc."),
    valor_compraventa: confField("Valor del acto principal en pesos (solo número)"),
    es_hipoteca: confBoolField("true si incluye hipoteca"),
    valor_hipoteca: confField("Valor hipoteca en pesos (0 si sin límite de cuantía)"),
    entidad_bancaria: confField("Nombre de la entidad bancaria acreedora"),
    entidad_nit: confField("NIT de la entidad bancaria con dígito verificador"),
    afectacion_vivienda_familiar: confBoolField("true si tiene afectación a vivienda familiar"),
    actos_secundarios: {
      type: "array",
      items: confField("Descripción breve de acto secundario"),
      description: "Otros actos registrados (cancelaciones, afectaciones, etc.)"
    }
  },
  required: ["tipo_acto_principal"],
}
```

Actualizar `baseSystemPrompts.certificado_tradicion` para incluir instrucción de buscar la sección "ACTOS: CUANTÍA" y los actos registrados con sus valores.

Agregar `"actos"` a la lista `required` del tool (junto a documento, inmueble, personas).

**Archivo 2: `src/lib/bankDirectory.ts`** (nuevo)

Diccionario de ~15 bancos colombianos principales con NIT y domicilio. Función `lookupBank(name: string)` con matching fuzzy por `includes`.

**Archivo 3: `src/pages/Validacion.tsx`**

1. Agregar `manuallyEditedFieldsRef = useRef<Set<string>>(new Set())` 
2. En `handleFieldEdit`: registrar campo en el set
3. Agregar `handleActosExtracted` con dirty-field checks + `cleanCurrency` para valores monetarios + lookup en `bankDirectory` para autocompletar NIT/domicilio
4. En `loadTramite`: si `meta.extracted_actos` existe y no hay `actos` en DB, pre-poblar estado con dirty-check
5. Pasar `onActosExtracted={handleActosExtracted}` a `InmuebleForm`
6. En `actosToRow`: agregar `afectacion_vivienda_familiar: a.afectacion_vivienda_familiar ?? false`

**Archivo 4: `src/components/tramites/InmuebleForm.tsx`**

1. Agregar prop `onActosExtracted?: (actos: Record<string, any>) => void`
2. En `handleScanDocument` para `certificado_tradicion`: si `d.actos` existe, emitir `onActosExtracted(d.actos)` después de unwrap de confianza
3. Unwrap de confianza para el nodo actos igual que para inmueble y personas

**Archivo 5: `src/components/tramites/DocumentUploadStep.tsx`**

En `handleContinue`: al procesar certificado, si `result.actos`, guardar en `metadata.extracted_actos`.

**Archivo 6: `src/components/tramites/PersonaForm.tsx`**

Agregar indicador sutil en campos vacíos cuando el nombre y cédula están llenos pero estado_civil/dirección están vacíos:
```
<span className="text-xs text-muted-foreground italic">
  ⓘ Escanea la cédula para completar
</span>
```

**Archivo 7: `src/components/tramites/DocxPreview.tsx`**

En `buildReplacements`: agregar `"actos.afectacion_vivienda"` placeholder. Importar `lookupBank` y usarlo como fallback para `entidad_nit` y `entidad_domicilio` cuando están vacíos pero `entidad_bancaria` tiene valor.

**Archivo 8: `src/lib/types.ts`**

Agregar `afectacion_vivienda_familiar?: boolean` a la interfaz `Actos` y al `createEmptyActos()`.

### Resumen

| Archivo | Cambio |
|---|---|
| `supabase/functions/scan-document/index.ts` | +nodo `actos` en schema certificado, prompt expandido |
| `src/lib/bankDirectory.ts` | Nuevo: diccionario de bancos colombianos |
| `src/lib/types.ts` | +`afectacion_vivienda_familiar` en Actos |
| `src/pages/Validacion.tsx` | dirty-fields tracker, handleActosExtracted con cleanCurrency + bank lookup, loadTramite con extracted_actos |
| `src/components/tramites/InmuebleForm.tsx` | +prop onActosExtracted, emitir actos del certificado |
| `src/components/tramites/DocumentUploadStep.tsx` | Guardar extracted_actos en metadata |
| `src/components/tramites/PersonaForm.tsx` | Indicador "Escanea la cédula" |
| `src/components/tramites/DocxPreview.tsx` | Bank lookup fallback para NIT/domicilio, placeholder afectación |

8 archivos (1 nuevo) + 0 migraciones DB (la columna `afectacion_vivienda_familiar` ya existe en la tabla `actos`).

