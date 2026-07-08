
# Auditoría A10 — "Datos del apoderado del banco hardcodeados (APODERADO_FIJO)"

**Modo:** SOLO LECTURA. No se implementa nada.

## 1. Búsqueda de residuos hardcodeados

Búsqueda exhaustiva en `src/` y `supabase/functions/`:

```
rg -i "APODERADO_FIJO|APODERADO_DEFAULT|apoderado_default|hardcoded.*apoderado|FIJO.*apoderado"
→ 0 hits
rg -i "apoderado_nombre.*=.*'[A-ZÁÉÍÓÚÑ ]{5,}'"   (asignación literal de nombre)
→ 0 hits
```

✅ **Cero residuos.** No existe ningún objeto tipo `APODERADO_FIJO`, ni cédula/nombre quemados en el código. El único string largo asociado a `apoderado_nombre` que aparece en el repo es "ANA MARIA MONTOYA ECHEVERRY" en el test `PODER-3` (`index_test.ts:253`) — es un **fixture de test**, no valor de producción.

Comentario explícito en `supabase/functions/procesar-cancelacion/index.ts:76`:
> `// NO hay apoderado hardcodeado. Si no se carga el Poder General, los campos ...`

## 2. Comportamiento cuando el poder NO se adjunta

`buildDocxVars` en `supabase/functions/procesar-cancelacion/index.ts:1078-1088`:

```ts
// Apoderado dinámico (sin hardcode). undefined → nullGetter → "___________"
apoderado_nombre: sanitizeString(pb.apoderado_nombre),
apoderado_cedula: sanitizeString(pb.apoderado_cedula),
apoderado_escritura: formatProtocoloEscritura(sanitizeString(pb.apoderado_escritura) || ""),
apoderado_fecha: sanitizeString(pb.apoderado_fecha),
apoderado_fecha_dia: sanitizeString(pb.apoderado_fecha_dia) || fpPoder.dia || undefined,
apoderado_fecha_mes: sanitizeString(pb.apoderado_fecha_mes) || fpPoder.mes || undefined,
apoderado_fecha_ano: sanitizeString(pb.apoderado_fecha_anio) || fpPoder.ano || undefined,
apoderado_notaria_poder: formatProtocoloNotaria(sanitizeString(pb.apoderado_notaria_poder) || ""),
```

`nullGetter` en `L1168-1169`:
```ts
nullGetter: (part) =>
  part?.value && SLIM_FIELDS.has(part.value) ? "—" : "___________",
```

**Ruta cuando no hay poder:** `pb` = objeto vacío → `sanitizeString(undefined)` → `undefined` → Docxtemplater invoca `nullGetter` → imprime `"___________"` (o `"—"` en campos "slim" que deformarían tablas). ✅ Nunca aparece un nombre inventado.

`sanitizeString` (probado en `src/shared/sanitizeNullPattern.test.ts`, 18 tests verdes) también convierte a `undefined` la basura literal `"null"`, `"undefined"`, `"NaN"`, `"---"`, `"N/A"`, `""`, evitando el patrón "null" incrustado histórico (B5).

## 3. Evidencia en cancelaciones reales

Query sobre las 14 cancelaciones con `data_final`:

| id | `apoderado_nombre` | `apoderado_cedula` |
|---|---|---|
| `32f5317e…` (2026-07-08) | **null** | **null** |
| `0443d2f1…` (2026-07-07) | **null** | **null** |
| `498c0215…` (2026-06-01) | **null** | **null** |
| `9a78aebb…` | ANA MARIA MONTOYA ECHEVERRY | 521639-4 |
| `c506d69b…` | ANA MARIA MONTOYA ECHEVERRY | 41944755 |
| `2fb6ba16…` | ANA MARIA MONTOYA ECHEVERRY | 41525143 |
| `15582708…` | ANA MARIA MONTOYA ECHEVERRY | 79.123.456 |
| `2bef1db3…` | FELIX DE JESUS CAGUA | 79.123.456 |
| `290fd66a…` | FELIX REUZE CAÑAS | 19.345.545 |
| `4b05d210…` | MARIA CAMILA PEÑA RAMÍREZ | 101.846.520 |
| `0e80553d…` | LINA MAGALY CAMPOS LOSADA | 55069433 |
| `d7193993…` | ANA MARIA MONTOYA ECHEVERRY | 41.939.243 |
| `1d5b2aa7…` | ANDRES RODRIGO SANCHEZ RODRIGUEZ | 80.087.712 |
| `1ac20fa1…` | HEIBER HERNAN BELTRAN TORRES | 1033718974 |

**Interpretación:**
- **3 casos con `apoderado_nombre = null` y `apoderado_cedula = null`** (`32f5317e`, `0443d2f1`, `498c0215`) — poder no adjuntado. ✅ Comportamiento correcto: no hay nombre inventado, quedaron vacíos → en el docx renderizado saldrán como `"___________"` vía `nullGetter`.
- **Nombres variados** en los otros 11 casos (7 personas distintas): ANA MARIA MONTOYA, FELIX DE JESUS CAGUA, FELIX REUZE CAÑAS, MARIA CAMILA PEÑA, LINA CAMPOS, ANDRES SANCHEZ, HEIBER BELTRAN. ✅ Si hubiera hardcode, todos serían idénticos.
- **Cédulas variadas** incluso para la misma persona (ANA MARIA aparece con 4 cédulas distintas: 521639-4, 41944755, 41525143, 79.123.456, 41.939.243) — ruido de OCR/edición humana, pero **descarta hardcode categóricamente**.

⚠️ **Observación honesta (no bloqueante para A10):** las 5 cédulas distintas para "ANA MARIA MONTOYA ECHEVERRY" sugieren ruido de extracción/reconciliación en `poder_banco.apoderado_cedula` — no es el bug de A10 (nombre falso), pero merece una auditoría separada de calidad de extracción de cédula del apoderado.

## 4. Tests automatizados

`rg "sin poder|poder ausente|apoderado.*undefined"` en repo:
- **PODER-1, PODER-2, PODER-4** (`index_test.ts:225-270`) cubren "basura literal → undefined → nullGetter" en campos apoderado.
- **PODER-3** cubre "apoderado real → preserva valores".
- **`sanitizeNullPattern.test.ts`** (18 tests) blinda el sanitizer.

⚠️ **Brecha:** no existe un test específico que aserte "`pb = {}` (poder totalmente ausente) → los 6 campos apoderado (`nombre/cedula/escritura/fecha/fecha_dia/mes/ano/notaria_poder`) son `undefined`". PODER-1/2 lo cubren indirectamente (input basura → undefined), pero no el caso literal de objeto vacío. Si alguien reintrodujera un fallback tipo `pb.apoderado_nombre || "APODERADO"`, PODER-1/2 seguirían verdes.

## 5. Veredicto

✅ **RESUELTO CON EVIDENCIA REAL.**

- Cero código hardcodeado en producción (0 hits en búsqueda exhaustiva).
- Comentario explícito y arquitectura `sanitizeString + nullGetter` sólida.
- **3 cancelaciones reales sin poder** muestran `null` en `data_final`, no nombre inventado.
- 11 cancelaciones con poder muestran 7 nombres y 10 cédulas distintas → descarta hardcode.

⚠️ **Deuda menor:**
1. Falta un test explícito de "poder totalmente ausente → campos undefined" (los existentes cubren basura pero no vacío total). Cerrar la brecha es ~10 líneas.
2. La variabilidad de cédulas para el mismo apoderado sugiere ruido de OCR en `apoderado_cedula` — auditoría separada, no toca A10.

No se implementa nada.
