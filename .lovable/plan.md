# Fix H2 — bug legal `null` incrustado en minuta de cancelaciones

## Causa raíz (confirmada por trazado + screenshot en producción)

Ruta del bug (`procesar-cancelacion/index.ts`):

1. **Extractor dedicado de cuantía** (~L1641-1750) puede devolver tres estados:
   - Monto real → `valor_hipoteca_original="<letras> ($N)"`, `es_indeterminada=false`, `motivo_null=null`.
   - **Indeterminada confirmada** → `valor_hipoteca_original=null`, `es_indeterminada=true`, `motivo_null="escritura_declara_abierta"`.
   - Ambigua / sin evidencia → `valor_hipoteca_original=null`, `es_indeterminada=false`, `motivo_null="ambigua_multiple"|"sin_evidencia"`.

2. **`mergeCuantiaIntoExtracted`** (L1778-1793) y su gemelo del reproceso (L2266-2287) solo actúan cuando `dedicadaMonto` **no está vacío**. Cuando el dedicado confirmó indeterminada, `dedicadaMonto=""` y el merge **retorna sin tocar nada** → el estado del monolítico sobrevive tal cual quedó en `data_final`.

3. Si en algún paso previo (merge cliente / `?? "null"` / JSON round-trip) `valor_hipoteca_original` acabó como el **string literal `"null"`** y `es_indeterminada=false`, ese estado se persiste. Es exactamente lo que vemos en las 5 filas del Grupo C.

4. **`buildDocxVars`** (L786-795) lee `valorRaw = "null"`, no matchea el regex legacy `HIPOTECA…INDETERMINADA`, `esCuantiaIndeterminada=false`, y pasa `valor_hipoteca_original="null"` a la plantilla → sale la palabra **`null`** en la prosa notarial (confirmado por screenshot).

## Fix propuesto — dos capas de defensa + normalización

### Capa 1 — Propagar indeterminada confirmada desde el extractor dedicado

En **ambos** puntos de merge (`mergeCuantiaIntoExtracted` L1778-1793 y el bloque de reproceso L2266-2287), añadir rama simétrica: cuando `dedicada?.valor_hipoteca_es_indeterminada === true` **o** `dedicada?.motivo_null === "escritura_declara_abierta"`, escribir en el destino (respetando humano igual que hoy):

```ts
// pseudo-diff L1778-1793
function mergeCuantiaIntoExtracted(extracted, dedicada) {
  if (!dedicada) return { applied: false, monto: null };
  const monoMonto = (extracted.hipoteca_anterior.valor_hipoteca_original ?? "").trim();
  const monoIndet = extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada === true;
  const certVacio = monoMonto === "" || monoIndet;
  if (!certVacio) return { applied: false, monto: null };

  const dedicadaMonto = (dedicada.valor_hipoteca_original ?? "").trim();
  const dedicadaIndet = dedicada.valor_hipoteca_es_indeterminada === true
    || dedicada.motivo_null === "escritura_declara_abierta";

  if (dedicadaMonto) {
    extracted.hipoteca_anterior.valor_hipoteca_original = dedicadaMonto;
    extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = false;
    extracted.hipoteca_anterior.cuantia_origen = "escritura";
    return { applied: true, monto: dedicadaMonto };
  }
  if (dedicadaIndet) {
    extracted.hipoteca_anterior.valor_hipoteca_original = "";           // vacío real, no "null"
    extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = true; // flag correcto
    extracted.hipoteca_anterior.cuantia_origen = "escritura";
    return { applied: true, monto: null };
  }
  return { applied: false, monto: null };
}
```

Cambio equivalente en el reproceso manual (L2266-2287): si `dedicadaIndet` y `(finalMontoActual === "" || finalIndet)`, escribir `original=""`, `es_indeterminada=true`, `cuantia_origen="escritura"`, `aplicado=true`. También limpiar el espejo plano (`updatePayload.valor_hipoteca_original = null`).

### Capa 2 — Red de seguridad en `buildDocxVars`

En L786-795, normalizar valores basura antes de decidir la rama:

```ts
const rawIn = (data.hipoteca_anterior.valor_hipoteca_original || "").trim();
const isTrash = /^(null|undefined|nan)$/i.test(rawIn);
const valorRaw = isTrash ? "" : rawIn;

const esIndeterminadaIA = data.hipoteca_anterior.valor_hipoteca_es_indeterminada === true;
const esIndeterminadaLegacy = /HIPOTECA\s+DE\s+CUANT[IÍ]A\s+INDETERMINADA/i.test(valorRaw);
// Guard defensivo: valor basura + certificado marcado indeterminada en OCR → tratar como indet.
// Sin señal, degrada a "vacío" (la plantilla pinta ______ y el notario completa).
const esCuantiaIndeterminada = esIndeterminadaIA || esIndeterminadaLegacy || (isTrash && esIndeterminadaIA);
// Resto igual — nunca puede llegar "null" literal al Docxtemplater.
```

Efecto: aunque llegue basura por cualquier ruta futura, **la palabra `null` nunca puede imprimirse**. Si además el flag decía `true`, sale la leyenda correcta; si no, sale línea en blanco (no palabra tóxica).

### Sin cambios en la plantilla ni en el helper `buildClausulaPagoHipoteca`
El helper ya se rige por `esCuantiaIndeterminada` calculado arriba, así que corrige automáticamente.

## Tests nuevos (Deno, `procesar-cancelacion/index_test.ts` + `_regression_cuantia.ts`)

1. **Extractor dedicado confirma indeterminada** (`mergeCuantiaIntoExtracted` con `{valor_hipoteca_original:null, valor_hipoteca_es_indeterminada:true, motivo_null:"escritura_declara_abierta"}` sobre monolítico vacío) → flag queda `true`, original queda `""`, `cuantia_origen="escritura"`, `applied=true`.
2. **`buildDocxVars` con basura**: input `valor_hipoteca_original="null"`, flag `false` → `esCuantiaIndeterminada=false` (no hay señal positiva) pero el campo `valor_hipoteca_original` que llega a la plantilla es `undefined`, nunca `"null"`. Verificar que `buildClausulaPagoHipoteca` no incluye la palabra `null`.
3. **`buildDocxVars` basura + flag `true`** → sale leyenda "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA", no `$`, no `null`.
4. **Regresión monto real**: mono con `"CIENTO VEINTE MILLONES … ($120.000.000)"` y flag `false` → sale prosa determinada con el monto (idéntica a hoy).
5. **Regresión merge cliente/humano**: `data_final.hipoteca_anterior.valor_hipoteca_original="OCHENTA MILLONES ($80.000.000)"` — el reproceso NO lo pisa.

## Remediación de datos existentes (SOLO LECTURA, NO ejecutar)

Query de diagnóstico para dimensionar alcance histórico completo:

```sql
SELECT
  id,
  status,
  created_at,
  data_final->'hipoteca_anterior'->>'valor_hipoteca_original'  AS vh_original,
  data_final->'hipoteca_anterior'->>'valor_hipoteca_es_indeterminada' AS vh_flag,
  data_final->'hipoteca_anterior'->>'cuantia_origen' AS origen,
  valor_hipoteca_original AS espejo_plano
FROM cancelaciones
WHERE
  LOWER(TRIM(COALESCE(data_final->'hipoteca_anterior'->>'valor_hipoteca_original',''))) IN ('null','undefined','nan')
  OR LOWER(TRIM(COALESCE(valor_hipoteca_original,''))) IN ('null','undefined','nan')
ORDER BY created_at DESC;
```

Salida esperada: conteo real de filas afectadas (mínimo las 5 conocidas del Grupo C). Con base en ese conteo decidiremos remediación (UPDATE por lotes o re-ejecutar reproceso manual pieza por pieza) — **no incluido en este plan**, se define después de ver alcance.

## Archivos a modificar (fase build, tras aprobación)

- `supabase/functions/procesar-cancelacion/index.ts` — rama indeterminada en `mergeCuantiaIntoExtracted` (L1778-1793) + gemela en reproceso (L2266-2287) + guard basura en `buildDocxVars` (L786-795).
- `supabase/functions/procesar-cancelacion/index_test.ts` — 5 tests nuevos descritos arriba.
- `supabase/functions/procesar-cancelacion/_regression_cuantia.ts` — sumar caso "dedicado confirma indeterminada".

## Riesgos y no-cambios

- **Cero cambios en la plantilla docx**, en el schema del extractor, en los prompts o en el frontend.
- Flujo normal (monto real detectado por monolítico) recorre exactamente las mismas líneas de hoy — el guard `isTrash` solo actúa sobre strings basura.
- Ambigua/sin_evidencia sigue degradando a línea en blanco (comportamiento actual preservado); solo `escritura_declara_abierta` se convierte en flag `true`, que es semánticamente correcto.
- Redespliegue de `procesar-cancelacion` requerido; sin migración SQL.

## Pendiente explícito (fuera de este plan)

- Ejecución de la query de auditoría histórica y decisión de remediación de datos.
- Fase E de bloqueo duro previa a generación cuando la cuantía siga en estado dudoso tras el fix (conversación separada, igual que Fase E de NO_LEGIBLE).
