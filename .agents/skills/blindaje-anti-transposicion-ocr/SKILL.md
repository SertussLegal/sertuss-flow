---
name: blindaje-anti-transposicion-ocr
description: Cuándo y cómo redundar extracciones OCR sobre un mismo campo crítico
  para detectar transposiciones de dígitos y ruido de reconocimiento comparando
  N menciones independientes del mismo dato dentro de un documento. Patrón
  arquitectónico reutilizable (ya aplicado 3 veces en Sertuss: menciones_rl del
  RL del banco, menciones_direccion e menciones_matricula del inmueble en
  cancelaciones).
---

# Blindaje anti-transposición OCR

Patrón determinista para atrapar alucinaciones de OCR sobre campos críticos que
el documento fuente repite en múltiples lugares. La IA nunca audita su propia
alucinación; el código cuenta y compara.

---

## 1) Cuándo aplica

Todas estas condiciones a la vez:

- El documento fuente repite el dato ≥ 2 veces de forma independiente (encabezado
  + pie de anotación, cuerpo + firma + certificado embebido, bloque numerado con
  regla "índice más alto", etc.).
- El dato es **crítico** legal/registralmente: cédula, matrícula inmobiliaria,
  dirección catastral, NIT, número de escritura, número de anotación.
- Una transposición o lectura errónea produce daño real (docx generado con
  matrícula equivocada, hard-block ausente, escritura rechazada por el
  registrador).

**No aplica** cuando el dato ya se puede validar por checksum o dígito verificador
(ej. NIT con DV correcto es autovalidable; blindar por menciones sería sobre-
ingeniería). Tampoco cuando el documento estructuralmente **solo** puede tener
una mención (ej. `numero_escritura` en la carátula de una escritura pública).

---

## 2) Diseño del campo `menciones_X[]`

Array emitido por el tool **antes** del campo canónico, que sigue aplicando las
reglas de negocio de siempre (índice más alto, formato TEXTO (NÚMERO), sufijos
notariales…). El array es evidencia forense cruda; el escalar canónico es lo que
se renderiza.

```ts
menciones_X: {
  type: "array",
  description: "TODAS las menciones INDEPENDIENTES de <dato> tal como aparecen
    LITERALMENTE en el documento, ANTES de aplicar reglas de negocio o
    reformatear. Una entrada por aparición. Si solo hay una mención legible,
    emite 1 sola entrada. NO reemplaza al campo canónico.",
  items: {
    type: "object",
    properties: {
      seccion: { type: "string" }, // "ENCABEZADO", "ANOTACION_7", "FIRMA", ...
      valor:   { type: "string" }, // transcripción literal
      pagina:  { type: "number" }, // opcional
    },
    required: ["seccion", "valor"],
    additionalProperties: false,
  },
},
```

**Instrucción al prompt** (bloque "BLINDAJE ANTI-TRANSPOSICIÓN"):

> Antes de emitir `<campo_canonico>`, transcribe ADEMÁS en `menciones_X[]` cada
> mención de `<dato>` tal como aparece LITERALMENTE — sin reformatear, sin
> verbalizar, sin reordenar. Una entrada por aparición independiente. Objetivo:
> permitir al backend detectar transposiciones. Emite honestamente; si solo hay
> una mención legible, emite una.

---

## 3) Regla de coherencia

Vive en un módulo **isomórfico** (`supabase/functions/_shared/isomorphic/…`),
puro TS, sin `fetch`, sin `Deno`, sin dependencias runtime. Nunca lanza;
devuelve `{ warnings, suspicious }`.

### Tolerancias no negociables

Estas cinco tolerancias son parte del contrato del patrón. Cambiarlas rompe
casos reales que ya cubrimos con tests:

1. **1 sola mención → no dispara.** Menciones únicas legítimas existen
   (dirección con un solo renglón, certificado corto). Ver caso 3 de
   `poderBancoValidateMencionesRL.test.ts`.
2. **`NULLY_MENCION` filtra antes de comparar:** `""`, `"NO_LEGIBLE"`,
   `"N/A"`, `"NULL"`, `"UNDEFINED"` (uppercase, trim) se descartan del set.
3. **Payload legacy sin `menciones_X` → no dispara.** `Array.isArray(...)` y
   `.length >= 2` como guard duro. Nunca romper trámites viejos.
4. **Normalización determinista antes de `new Set(...).size >= 2`.** Ver §4.
5. **Warning con sufijo `_menciones_incoherentes`** → engancha automáticamente
   `HARD_BLOCK_WARNING_SUFFIXES` en `poderBancoExtractor/validate.ts` sin migrar
   la constante. `isHardBlockCoherenciaWarning(w)` lo reconoce solo.

### Forma canónica

```ts
export function validateXCoherencia(
  obj: Record<string, unknown> | null | undefined,
): { warnings: string[]; suspicious: Set<string> } {
  const warnings: string[] = [];
  const suspicious = new Set<string>();
  if (!obj || typeof obj !== "object") return { warnings, suspicious };

  const menciones = (obj.menciones_X ?? []) as Array<Record<string, unknown>>;
  if (Array.isArray(menciones) && menciones.length >= 2) {
    const vals = menciones
      .map((m) => String(m?.valor ?? "").trim())
      .filter((v) => v && !NULLY_MENCION.has(v.toUpperCase()))
      .map(normalizeXForCompare)
      .filter((v) => v);
    if (new Set(vals).size >= 2) {
      warnings.push("x_menciones_incoherentes");
      suspicious.add("obj.menciones_X");          // array crudo
      suspicious.add("obj.campo_canonico_X");     // escalar renderizado
    }
  }
  return { warnings, suspicious };
}
```

`suspicious` **siempre** incluye tanto el array crudo como el escalar canónico:
la UI marca ambos y el humano puede corregir el canónico (§5) sin perder la
evidencia.

---

## 4) Normalización antes de comparar

Regla dorada: **normalizar solo lo que no es semánticamente significativo para
detectar transposición**.

- ✅ Uppercase.
- ✅ Colapso de espacios repetidos y separadores de formato irrelevantes.
- ✅ Verbalización `"GUION"` → `"-"` (idiotismo de OCR notarial colombiano).
- ✅ Strip de coletillas fijas (`(DIRECCION CATASTRAL)`, sufijo de ciudad).
- ✅ Puntos y guiones cosméticos en matrículas / NITs (`50C-1572091` ≡
  `50C 1572091` ≡ `50C.1572091`, pero **no** ≡ `50C-1572081`).
- ❌ Nunca colapsar dígitos ni letras alfanuméricas.
- ❌ Nunca reordenar tokens.
- ❌ Nunca aplicar fuzzy match / distancia de edición / "parecido".

El punto entero del blindaje es que `13C-05` vs `13C-09` **debe** disparar. Si la
normalización los iguala, el skill está mal implementado.

Reutilizar utilidades ya vivas cuando existan:

- `sanitizeMatricula` (`procesar-cancelacion/index.ts`).
- `sanitizeNomenclaturaBase` (skill `direccion-completa-saneada-cancelacion`).
- Normalizadores del skill `verificar-consistencia-notarial` para NITs.

---

## 5) Excepción Manual > OCR

Cuando existe un campo escalar editable por humano que representa el mismo dato
(típico: cédula del RL en `poderdante.representante_legal_cedula`), la validación
humana confirmada **suprime** el warning aunque `menciones_X` sigan
incoherentes.

- Patrón: flag `_coherencia_confirmed_by_human` (ya usado en Regla 5 de
  `validatePoderBancoCoherencia`).
- Requiere **ambas** condiciones: (a) escalar canónico legible y válido según
  la regla de negocio (`isCedulaValida`, matrícula con dígitos suficientes,
  etc.) **y** (b) confirmación humana explícita.
- `menciones_X` se preservan intactos como evidencia forense — nunca borrarlos
  al confirmar. El humano gana, pero el rastro queda.
- Sin `(a) + (b)` juntos → el warning sigue activo. No suprimir prematuramente.

Ver skill `validar-poder-general-banco` §Regla 5 para el precedente canónico.

---

## 6) Preservación en merges

`mergeRegenPayload` y equivalentes deben hacer **deep-merge por clave dentro
del subobjeto** que contiene `menciones_X`. Editar un escalar hermano nunca
puede borrar el array de menciones.

- Ver `supabase/functions/_shared/isomorphic/mergeRegenPayload.ts` — trata
  `poderdante` con deep-merge key-by-key para no perder `menciones_rl` cuando
  el humano edita solo `representante_legal_cedula`.
- Contrato testeable: `mergeRegenPayload.test.ts` cubre el caso "override
  parcial no borra menciones_*".

Si el patrón se aplica a un nuevo subobjeto, agregar el key al deep-merge y el
test correspondiente.

---

## 7) Anti-ejemplos

- ❌ **Disparar con 1 sola mención.** Rompe casos legítimos de mención única.
- ❌ **Comparar sin normalizar.** Falsos positivos por espacios/puntuación.
- ❌ **Normalizar tan agresivamente que se pierde la diferencia.** `13C-05` vs
  `13C-09` no puede colapsarse a `13C`.
- ❌ **Poner la regla en el prompt del modelo** ("detecta si estos números son
  diferentes"). El modelo ya alucinó una vez; no le pidas que audite su propia
  alucinación. La regla es código determinista.
- ❌ **Contar/agrupar con IA.** El código cuenta. Filosofía de producto
  Sertuss: "contar/agregar con precisión es trabajo del código, no de la IA".
- ❌ **Warning sin sufijo `_menciones_incoherentes`.** Se pierde el enganche
  automático a `HARD_BLOCK_WARNING_SUFFIXES`.
- ❌ **Borrar `menciones_X` al confirmar humano.** Se pierde la evidencia
  forense; el diff `IA vs humano` para `descubrir-reglas` queda ciego.
- ❌ **Fuzzy match / Levenshtein.** No es este patrón. Si necesitas fuzzy es
  otro problema (ver skill `verificar-consistencia-notarial` Regla 2, y solo
  como respaldo cuando falta NIT).

---

## 8) Aplicaciones vivas y pendientes

### Vivas (3)

| # | Campo | Módulo | Warning | Tests |
|---|---|---|---|---|
| 1 | `poderdante.menciones_rl` (cédula RL banco) | `poderBancoExtractor/validate.ts` Regla 5 | `rl_banco_menciones_incoherentes` | `poderBancoValidateMencionesRL.test.ts` |
| 2 | `inmueble.menciones_direccion` (cancelaciones) | `_shared/isomorphic/certificadoInmuebleValidate.ts` | `inmueble_direccion_menciones_incoherentes` | `certificadoInmuebleValidate.test.ts` |
| 3 | `inmueble.menciones_matricula` (cancelaciones) | `_shared/isomorphic/certificadoInmuebleValidate.ts` | `inmueble_matricula_menciones_incoherentes` | `certificadoInmuebleValidate.test.ts` |

### 4ª aplicación identificada — PAUSADA

**Extensión a compraventa** (`scan-document/core/certificadoTradicion/tool.ts` +
`supabase/functions/process-expediente/`).

Estado a fecha de este skill (investigación realizada, código sin tocar):

- `certificadoTradicion/tool.ts` sigue siendo el extractor de compraventa; no
  tiene `menciones_direccion` / `menciones_matricula` — mismo estado "una sola
  lectura" que cancelaciones antes del blindaje. La regla "índice más alto"
  vive enterrada en la `description` del campo `direccion`.
- `process-expediente/index.ts` **no llama a Gemini** para re-parsear el
  certificado; consume el JSON ya extraído por `scan-document`.
- `process-expediente` **no tiene ninguna infraestructura de coherencia hoy**:
  ni `_coherencia_warnings`, ni `detectRequiereRevisionManual`, ni clase
  `ManualReviewRequiredError`, ni columna persistente equivalente a
  `cancelaciones.revision_manual_requerida`, ni UI de badges tipo
  `PoderBannersV5`, ni guard en el choke point de generación del docx de
  compraventa. Grep confirma 0 matches para todos estos símbolos.
- `process-expediente` y `procesar-cancelacion` **no comparten isomórficos hoy
  en producción** — solo `procesar-cancelacion` importa de `_shared/isomorphic/`.
  Pero `certificadoInmuebleValidate.ts` es puro TS sin dependencias de
  cancelaciones, así que es directamente reutilizable por compraventa sin
  duplicar (no aplica el 3× espejo que sí tuvimos con M/CTE).

Alcance real cuando compraventa se retome:

| Pieza | Estado | Trabajo |
|---|---|---|
| Schema `menciones_*` en `certificadoTradicion/tool.ts` | falta | agregar (espejo del de cancelaciones) |
| Prompt "BLINDAJE ANTI-TRANSPOSICIÓN" | falta | agregar bloque idéntico |
| Validador `validateInmuebleCoherencia` | ✅ ya existe isomórfico | reutilizar tal cual |
| Wiring server-side + hard-block en `process-expediente` | **no existe infra** | diseño mayor (Fase 2b), decisión aparte |
| UI badges/suspicious en `Validacion.tsx` | no existe | diseño mayor |

**Recomendación de fases** cuando se retome:

- **Fase 2a** — solo schema + prompt + una anotación suave que devuelva
  warnings al frontend (sin hard-block). Barato, no bloquea, ya cubre 80% del
  valor porque marca sospecha visible.
- **Fase 2b** — portar el hard-block completo a `process-expediente`:
  `annotateInmuebleCoherencia`, columna persistente, badges, guard en el docx.
  Decisión de arquitectura mayor, requiere alineación con el usuario sobre
  cuánto queremos que compraventa se comporte como cancelaciones.

**Por qué está pausada**: prioridad de negocio actual está en cancelaciones. El
bug ancla que motivó el blindaje (transposición `13C-09` vs `13C-05` en
escritura 7058) ya está tapado del lado de cancelaciones. En compraventa no hay
incidente reportado todavía; se activa cuando el módulo se retome o cuando
aparezca un caso real.
