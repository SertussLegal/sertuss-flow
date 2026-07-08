
# Auditoría A5 — Tabla "DATOS DE LA ESCRITURA PÚBLICA" (hipoteca anterior vs escritura nueva)

## 1. Código actual en `buildDocxVars` — `supabase/functions/procesar-cancelacion/index.ts`

**Bloque `_v2Overrides` (L974–L982)** — los tags que rellenan la tabla SNR se construyen desde variables `snr*` que a su vez leen **exclusivamente** de `data.hipoteca_anterior`:

```ts
// L940-L949
const haAtom = data.hipoteca_anterior as Record<string, unknown>;
const fechaAtom = (haAtom.fecha_escritura as {...} | undefined) || {};
const notariaAtom = (haAtom.notaria as {...} | undefined) || {};
const numeroEscrituraAtom = typeof haAtom.numero_escritura === "string" ? haAtom.numero_escritura : "";
const snrNumeroEscritura = numeroEscrituraAtom || extractCorto(data.hipoteca_anterior.numero_escritura_hipoteca || "");
const snrFechaDia = (fechaAtom.dia || fp.dia || "")...
const snrFechaMes = (fechaAtom.mes || fp.mes || "")...
const snrFechaAno = (fechaAtom.ano || fp.ano || extractAno(data.hipoteca_anterior.fecha_escritura_hipoteca)...)
const snrNotariaNumero = (notariaAtom.numero || notariaOrigenNum || "")...
const snrNotariaCiudad = (notariaAtom.ciudad || ciudadHipoteca || "")...

// L976-L982
numero_escritura_hipoteca_corto: pad4(snrNumeroEscritura) || undefined,
fecha_escritura_hipoteca_dia:     snrFechaDia || undefined,
fecha_escritura_hipoteca_mes:     snrFechaMes || undefined,
fecha_escritura_hipoteca_ano:     snrFechaAno || undefined,
notaria_hipoteca_numero:          pad4(snrNotariaNumero) || undefined,
ciudad_hipoteca:                  snrNotariaCiudad || undefined,
```

Cero referencias a `escritura_nueva.*` en este bloque. La única mención a la escritura nueva en `buildDocxVars` es aparte (L932, L1097–L1099, L1115), como tags **independientes** (`numero_escritura_nueva`, `numero_escritura_nueva_corto`, `escritura_nueva_numero_letras`) — es decir, los tags de la escritura nueva viven en su propio conjunto y NO invaden la tabla SNR.

**Veredicto de código:** ✅ correcto. Los tags de la tabla SNR (`*_hipoteca_*`) leen todos de `hipoteca_anterior`.

## 2. Plantilla docx — tags esperados

El fix depende de que la plantilla (bucket `cancelaciones-plantillas`) siga usando los tags `{numero_escritura_hipoteca_corto}`, `{fecha_escritura_hipoteca_dia/_mes/_ano}`, `{notaria_hipoteca_numero}`, `{ciudad_hipoteca}` en la tabla superior, y `{numero_escritura_nueva*}` sólo en el encabezado. Esto no se pudo inspeccionar directamente en esta auditoría (la plantilla es un binario en storage privado, no en el repo). **La evidencia indirecta** es que la lista blanca `SNR_ATOMIC_TAGS` (L1152-L1159 del mismo archivo) declara explícitamente los 6 tags de hipoteca_anterior como "atómicos SNR", lo que confirma el contrato de plantilla.

**Nota honesta:** no verifiqué byte a byte el XML de la plantilla v3 subida el 2026-07-04 (#1771). Si un usuario sube una plantilla nueva con tags renombrados, este fix se rompe silenciosamente.

## 3. Evidencia en cancelaciones reales

Query sobre las 5 cancelaciones más recientes con `data_final`:

| id | `numero_escritura_hipoteca` | `notaria_hipoteca` | `fecha_escritura_hipoteca` | `numero_escritura_nueva` |
|---|---|---|---|---|
| `c506d69b…` (2026-07-08 01:40) | QUINIENTOS CINCUENTA Y NUEVE (559) | VEINTIUNO (21) DE BOGOTA D.C. | QUINCE (15) DE FEBRERO DE DOS MIL DIECINUEVE (2019) | `null` |
| `2fb6ba16…` (2026-07-08 00:47) | idem 559 | idem N21 | idem 2019 | `null` |
| `9a78aebb…` (2026-07-07 23:32) | idem | idem | idem | `null` |
| `15582708…` (2026-07-07 23:02) | idem | idem | idem | `null` |
| `32f5317e…` (2026-07-07 21:55) | idem | idem | idem | `null` |

**Interpretación:**
- Los 5 casos tienen `hipoteca_anterior` con datos reales (escritura 559, Notaría 21 de Bogotá, fecha 15-feb-2019). ✅ La tabla SNR recibiría estos valores, no vacío.
- Los 5 casos tienen `numero_escritura_nueva = null` — comportamiento esperado: la escritura nueva se numera al radicar en notaría, no al generar la minuta. ✅ El encabezado superior queda en blanco como pide Alejandra.

## 4. Tests automatizados

`rg "Deno.test.*(SNR|hipoteca_anterior|tabla|escritura)" supabase/functions/procesar-cancelacion/index_test.ts` → **1 hit**:

- Test #2 (L47): `"SNR atómico: pad4 produce 4 dígitos (escritura, notaría, anotaciones)"` — valida el formato de padding, no la fuente semántica del dato.

**No existe un test que aserte específicamente:** "los tags `numero_escritura_hipoteca_corto`, `notaria_hipoteca_numero`, `fecha_escritura_hipoteca_dia/_mes/_ano` se poblan desde `data.hipoteca_anterior` y no desde `escritura_nueva`". La ausencia es honesta: el contrato hoy se sostiene por convención de naming (`*_hipoteca_*` → hipoteca_anterior) y por revisión visual de la minuta.

## 5. Veredicto

**Resuelto con evidencia real, con una brecha de cobertura de tests.**

- ✅ Código en `buildDocxVars` mapea correctamente los 6 tags de la tabla SNR desde `hipoteca_anterior`.
- ✅ Cero fuga: no hay ningún tag `*_hipoteca_*` que lea de `escritura_nueva.*`.
- ✅ 5/5 cancelaciones reales recientes muestran datos poblados de hipoteca anterior (escritura 559, Notaría 21, 2019) y `numero_escritura_nueva = null` — comportamiento esperado.
- ⚠️ **Brecha:** no hay test unitario que blinde la separación semántica. Si alguien en el futuro renombra un tag o cruza los campos, el bug histórico puede volver sin señal.
- ⚠️ **No verificado:** el XML de la plantilla v3 en storage — el contrato depende de que los tags de la plantilla coincidan con los del código.

**No se implementa nada en esta auditoría.**
