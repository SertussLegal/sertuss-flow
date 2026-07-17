# Plan — Cierre del bug "bloqueado para siempre" (5 warnings restantes) + test de cobertura permanente

## 0. Hallazgos previos a implementar (validados con grep en este turno)

**H1 — `isCedulaValida` NO excluye placeholders.**
Cuerpo real (`validate.ts:38-45`):
```ts
const CEDULA_RE = /^\d{6,10}$/;
export function isCedulaValida(c) {
  if (!c) return true;
  const norm = c.replace(/[.\s]/g, "");
  return CEDULA_RE.test(norm);
}
```
Solo valida FORMATO (6-10 dígitos). El placeholder `79123456` listado en `PODER_CEDULAS_PLACEHOLDER` (`validate.ts:85`) **pasa** `isCedulaValida` porque tiene 8 dígitos. Consecuencia directa para Parte B: **`isCedulaEditadaValida` NO es suficiente** como predicado de supresión de `apoderado_cedula_placeholder`. Si se usa solo ese predicado, un notario que "arregle" el warning dejando la misma cédula `79.123.456` (o cualquier otra en la lista de placeholders) desbloquearía el trámite y generaría un docx con cédula alucinada. El predicado real debe ser: formato válido **Y** cédula normalizada NO pertenece a `PODER_CEDULAS_PLACEHOLDER`.

**H2 — Validadores son 100% puros.**
Ambos archivos declaran explícitamente en su cabecera: `🛡️ PUREZA: solo TS. Isomórfico (edge + client). Sin fetch, sin Deno.` Grep de `fetch`, `Deno.`, `gemini`, `claude` en los 2 archivos: cero coincidencias. Costo IA del recálculo = 0. Riesgo mencionado en tu punto de "riesgos a documentar" queda descartado por evidencia.

**H3 — `detectRequiereRevisionManual` es interceptable sin reescritura.**
Cuerpo actual (`procesar-cancelacion/index.ts:1425-1475`) construye `motivos` así:
```ts
let motivos = [...warnings, ...warningsInm].filter(isHardBlockCoherenciaWarning);
if (opts?.manualReviewConfirmed) motivos = applyManualOverrideExceptions(motivos, extracted);
return { requiere: paths.length > 0 || motivos.length > 0, paths, motivos };
```
Es una lista plana de strings. Insertar UN paso entre esas 2 líneas — "quita los códigos escalares cuyo recálculo fresco ya no los emite" — es un delta de ~5 líneas. No requiere reescritura. Costo real de Parte A: **bajo, quirúrgico**.

**H4 — Todos los códigos hard-block existen como literales estáticos.**
Grep sobre `supabase/functions/_shared/isomorphic/` confirma que **no hay** `warnings.push(\`${x}_suffix\`)` dinámico. Todos los códigos (incluyendo `_no_legible`, `_confianza_baja`, `_duplicidad_cruzada`) están declarados como strings literales — sea en `warnings.push("codigo")` directo, sea como valor de campo `warning:` en tablas declarativas (Regla 3 no-legible en `validate.ts:288-297`, Regla 7 confianza en `validate.ts:444-462`). **El regex del test de cobertura es enumerable sin excepciones dinámicas**, contrario al riesgo que anticipaba el prompt. La Aserción 3 (cobertura → WARNING_LABELS) es factible sin comentario-caveat.

**H5 — `_no_legible` como CÓDIGO de warning coexiste con `"NO_LEGIBLE"` como CENTINELA de campo.**
Son 2 mecanismos distintos:
- `NO_LEGIBLE` centinela: `detectRequiereRevisionManual:1445` recorre 6 paths directamente sobre `extracted.poder_banco` — auto-resuelve al editar el campo (no vive en `_coherencia_warnings`).
- `_no_legible` código de warning (`apoderado_cedula_no_legible`, `escritura_poder_no_legible`, `fecha_poder_no_legible`): SÍ vive en `_coherencia_warnings` persistido y hoy tampoco tiene entrada en `MANUAL_OVERRIDE_RULES`. Comparte exactamente el mismo bug que los 4 `_incoherente`, con el mismo shape de datos. **Añadir estos 3 códigos al alcance de Parte A no cuesta prácticamente nada porque `validatePoderBancoCoherencia` ya los recalcula frescos en la misma llamada.** Ver decisión en §1.

## 1. Decisión de alcance final

Adoptamos **híbrido (opción 3 del turno anterior) ampliado** por H5:

- **Parte A (recálculo escalar para gating)**: cubre los 4 `_incoherente` explicitados **+ los 3 `_no_legible` de coherencia** (`apoderado_cedula_no_legible`, `escritura_poder_no_legible`, `fecha_poder_no_legible`) — todos son emitidos por `validatePoderBancoCoherencia`/`validateIntraTramite` sobre datos editables. Se recalculan por el mismo mecanismo y no agregan complejidad. Documentar esta ampliación explícitamente en la constante `SCALAR_COHERENCE_GATING_CODES` con comentario JSDoc.
- **Parte B (`MANUAL_OVERRIDE_RULES`)**: solo para `apoderado_cedula_placeholder`, con el predicado corregido por H1.
- **Fuera de alcance intencionadamente**:
  - `apoderado_nombre_duplicidad_cruzada` / `apoderado_cedula_duplicidad_cruzada` (`crossCheck.ts:86,91`) — el crossCheck es cruce inter-trámite (mismo apoderado usado en cancelaciones distintas de organizaciones distintas), no coherencia intra-trámite. Recalcularlo dentro de `generateAndUploadCancelacionDocs` requeriría acceso a `supabaseService` (no puro), viola la propiedad de H2 y expande el alcance. Se deja para un plan separado.
  - `_menciones_incoherentes` (los 4 ya arreglados hoy) — no se tocan, siguen resolviendo vía `MANUAL_OVERRIDE_RULES` existente.

## 2. Parte A — Recálculo escalar de gating

### 2.1 Nueva constante en `hardBlockRules.ts`
Export nuevo:
```ts
/** Códigos hard-block que se re-evalúan en el choke point de generación
 *  contra los datos EDITADOS (data.poder_banco + data.partes), no contra
 *  el _coherencia_warnings persistido. Si el recálculo fresco ya no los
 *  emite tras la edición humana, dejan de contar como motivo de bloqueo.
 *  Cero persistencia — la UI sigue viendo el array viejo hasta la próxima
 *  extracción real.
 *
 *  NO agregar aquí un código sin también:
 *   (a) confirmar que `validatePoderBancoCoherencia` o
 *       `validatePoderVsCancelacion` lo emiten sobre el shape de
 *       `data.poder_banco`/`data.partes` sin transformación, y
 *   (b) confirmar que el humano puede corregir al menos UN campo que
 *       influya en la re-evaluación (contra la UI real, no la intención).
 */
export const SCALAR_COHERENCE_GATING_CODES = [
  "escritura_num_incoherente",
  "fecha_incoherente",
  "poder_entidad_nit_incoherente",
  "poder_entidad_nombre_incoherente",
  "apoderado_cedula_no_legible",
  "escritura_poder_no_legible",
  "fecha_poder_no_legible",
] as const;
```

### 2.2 Nueva función en `procesar-cancelacion/index.ts`
Ubicación: junto a `applyManualOverrideExceptions` (mismo choke point conceptual).

```ts
/** Recálculo efímero de coherencia escalar sobre datos EDITADOS. Devuelve
 *  el set de códigos en SCALAR_COHERENCE_GATING_CODES que SIGUEN vigentes
 *  tras leer los valores actuales. No persiste nada. Puro. */
function recomputeScalarCoherenceForGating(data: CancelacionData): Set<string> {
  const pb = (data.poder_banco ?? {}) as Record<string, unknown>;
  const partes = {
    banco_nit: data.partes?.banco_nit,
    banco_acreedor: data.partes?.banco_acreedor,
  };
  const a = validatePoderBancoCoherencia(pb).warnings;
  const b = validatePoderVsCancelacion(pb, partes).warnings;
  const fresh = new Set([...a, ...b]);
  return new Set(SCALAR_COHERENCE_GATING_CODES.filter((c) => fresh.has(c)));
}
```

### 2.3 Intercepción en `detectRequiereRevisionManual`
Delta de 4 líneas entre el filtro hard-block y `applyManualOverrideExceptions`:

```ts
let motivos = [...warnings, ...warningsInm].filter(isHardBlockCoherenciaWarning);

// Recálculo escalar: los códigos gating que ya no se emiten frescos
// dejan de bloquear (los persistidos son un snapshot desactualizado).
const stillFresh = recomputeScalarCoherenceForGating(extracted);
motivos = motivos.filter((m) =>
  !(SCALAR_COHERENCE_GATING_CODES as readonly string[]).includes(m) || stillFresh.has(m)
);

if (opts?.manualReviewConfirmed === true) {
  motivos = applyManualOverrideExceptions(motivos, extracted);
}
```

**Propiedades preservadas:**
- El recálculo NO depende de `manualReviewConfirmed`. Los códigos escalares desactualizados se limpian siempre — es corrección de un snapshot obsoleto, no una excepción de política. `MANUAL_OVERRIDE_RULES` sigue siendo la vía para "el humano confirmó, la evidencia forense se preserva". Son mecanismos ortogonales.
- `paths` (NO_LEGIBLE centinela) queda intacto: mecanismo independiente sobre valores actuales, ya auto-resuelve por diseño.
- Orden preservado: recálculo → override manual. Si un código escalar sigue vigente tras la edición pero `MANUAL_OVERRIDE_RULES` lo cubre en el futuro, sigue funcionando.

### 2.4 Efectos secundarios verificados a NO tener
- No se escribe a `_coherencia_warnings` / `_coherencia_suspicious`. UI intacta.
- No se toca `annotatePoderCoherencia` / `annotatePoderIntraTramite`. Persistencia en `live_pipeline` / `reprocess_poder` intacta.
- `stripNullyStrings` corre antes en el pipeline: los validadores nunca ven `"null"` literal.

## 3. Parte B — `apoderado_cedula_placeholder` en `MANUAL_OVERRIDE_RULES`

En `hardBlockRules.ts`, nuevo predicado local + entrada:

```ts
import { PODER_CEDULAS_PLACEHOLDER, normalizeCedula } from "./validate.ts";

function isCedulaEditadaValidaNoPlaceholder(v: unknown): boolean {
  if (!isCedulaEditadaValida(v)) return false;
  const norm = normalizeCedula(v as string);
  return !!norm && !PODER_CEDULAS_PLACEHOLDER.has(norm);
}

// … dentro de MANUAL_OVERRIDE_RULES:
{
  warning: "apoderado_cedula_placeholder",
  canSuppress: (d) => {
    const pb = (d.poder_banco || {}) as Record<string, unknown>;
    return isCedulaEditadaValidaNoPlaceholder(pb.apoderado_cedula);
  },
},
```

Justificación H1: si usáramos `isCedulaEditadaValida` sola, el notario podría dejar `79.123.456` (que pasa el regex de 6-10 dígitos) y desbloquear un placeholder documentado como alucinación. Este predicado adicional cierra ese hueco.

## 4. Parte C — Tests

### 4.1 Test funcional del recálculo (nuevo archivo)
`src/shared/procesarCancelacion/scalarGatingRecompute.test.ts` (Vitest, importa `recomputeScalarCoherenceForGating` — requiere exportarla, o portarla a `_shared/isomorphic/` para poder importarla desde `src/`; ver §6 nota de packaging).

Casos:
1. `escritura_num_incoherente` persistido + `data.poder_banco.apoderado_escritura` editado para coincidir con `instrumento_poder.escritura_num` → `stillFresh` NO contiene el código → `detectRequiereRevisionManual` retorna `requiere:false` (asumiendo no otros bloqueadores).
2. Mismo caso pero valores todavía discrepantes → `stillFresh` SÍ contiene el código → bloqueo se mantiene.
3. `poder_entidad_nit_incoherente` persistido + `poderdante.entidad_nit` editado a coincidir con `partes.banco_nit` (que es inmutable UI, viene del certificado) → se destraba. **Escenario textual del skill `verificar-consistencia-notarial`**: el humano arbitra que el poder OTORGADO fue para el banco que efectivamente aparece en el certificado, corrigiendo la lectura OCR del poder.
4. `fecha_incoherente` + edición atómica DD/MM/AAAA en UI → `apoderado_fecha` recompuesto coincide con año de `instrumento_poder.fecha` → destraba.
5. `apoderado_cedula_no_legible` persistido + `apoderado_cedula` editado a valor válido → destraba.
6. **Regresión Parte B**: `apoderado_cedula_placeholder` con edición a `"79.123.456"` (placeholder conocido) → `MANUAL_OVERRIDE_RULES` NO suprime → sigue bloqueado.
7. **Regresión Parte B**: edición a cédula real válida `"52.123.456"` → SÍ suprime → destraba.
8. **Regresión de los 4 arreglados hoy**: caso con `rl_banco_menciones_incoherentes` + `manualReviewConfirmed:true` + `representante_legal_cedula` editado válido → sigue destrabando por `MANUAL_OVERRIDE_RULES` (nada de Parte A lo toca).
9. **Ortogonalidad**: caso con código escalar (`escritura_num_incoherente`) NO resuelto + `manualReviewConfirmed:true` → sigue bloqueado (Parte A no es un bypass de política, solo limpia snapshot obsoleto).

### 4.2 Test de cobertura permanente (nuevo archivo)
`src/shared/poderBancoExtractor/hardBlockCoverage.test.ts` — lee vía `readFileSync` los archivos fuente:
- `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts`
- `supabase/functions/_shared/isomorphic/poderBancoExtractor/validateIntraTramite.ts`
- `supabase/functions/_shared/isomorphic/poderBancoExtractor/crossCheck.ts`
- `supabase/functions/_shared/isomorphic/certificadoInmuebleValidate.ts`

Regexes:
- `WARNING_PUSH_RE = /warnings\.push\(\s*"([a-z_]+)"\s*\)/g` (literales directos)
- `WARNING_FIELD_RE = /\bwarning\s*:\s*"([a-z_]+)"\s*,/g` (tablas declarativas: Regla 3 no-legible, Regla 7 confianza)

Extrae el union de códigos. Divide por sufijo con `HARD_BLOCK_WARNING_SUFFIXES`:

**Aserción 1 — cobertura menciones**: todo código que termine en `_menciones_incoherentes` debe estar en `MANUAL_OVERRIDE_RULES.map(r => r.warning)`.

**Aserción 2 — cobertura escalar**: todo código que termine en `_incoherente` (excluyendo `_menciones_incoherentes`) O en `_no_legible` (que sea emitido por los archivos escaneados — no el centinela) debe estar en `SCALAR_COHERENCE_GATING_CODES` O en `MANUAL_OVERRIDE_RULES`.

**Aserción 3 — cobertura WARNING_LABELS**: todo código extraído debe tener entrada en `WARNING_LABELS`.

**Aserción 4 — cobertura placeholder/duplicidad**: todo código con sufijo `_placeholder` o `_duplicidad_cruzada` debe estar en `MANUAL_OVERRIDE_RULES` **o** documentado explícitamente en una lista `KNOWN_UNRESOLVABLE_HARD_BLOCKS` (nueva, en el mismo test) con comentario del por qué. Los `_duplicidad_cruzada` (crossCheck inter-trámite) van ahí con la razón de H5. Esto convierte cada excepción en una decisión visible en el diff, no en un olvido.

**Comentario permanente en el test** (documentando H4/H5 para futuros lectores):
```ts
// NOTA: todos los códigos hard-block del sistema son literales estáticos
// (no template literals). Grep confirmado 2026-07-17: cero
// `warnings.push(\`${x}_...\`)` en isomorphic/. Si en el futuro se
// introduce un push dinámico, este test debe extenderse para reconocerlo
// (o el push debe convertirse a literal, opción preferida).
//
// NO_LEGIBLE como CENTINELA de campo (data.poder_banco.<campo>==="NO_LEGIBLE")
// vive en detectRequiereRevisionManual.paths y auto-resuelve por relectura
// del valor actual — NO es un warning en _coherencia_warnings. Los CÓDIGOS
// *_no_legible que sí viven en _coherencia_warnings (apoderado_cedula_no_legible,
// escritura_poder_no_legible, fecha_poder_no_legible) están en
// SCALAR_COHERENCE_GATING_CODES y se resuelven vía recálculo escalar.
```

## 5. Riesgos documentados

- **Costo IA**: 0 (H2 verificado).
- **Costo de reescritura de `detectRequiereRevisionManual`**: 0. Es un delta de 4 líneas dentro de la misma función (H3).
- **UI drift**: la UI sigue mostrando badges/banners contra `_coherencia_warnings` persistido, aunque el gating diga "no bloqueado". Comportamiento esperado y deseado del plan: la persistencia solo se actualiza en un pipeline OCR real, no en cada regen. Si Alejandra pide luego que la UI también refleje "resuelto" antes de una re-extracción real, es un cambio B2 estructural aparte.
- **Ampliación por H5**: si Alejandra prefiere alcance estricto de "solo los 4 `_incoherente` originales" y NO extender a los 3 `_no_legible` de coherencia, es trivial recortar `SCALAR_COHERENCE_GATING_CODES` a 4 antes de implementar. El test 4.2 Aserción 2 seguiría exigiendo cobertura de esos 3 vía `MANUAL_OVERRIDE_RULES` o el registro `KNOWN_UNRESOLVABLE_HARD_BLOCKS`, forzando decisión explícita.
- **Placeholder no exhaustivo**: `PODER_CEDULAS_PLACEHOLDER` hoy tiene 1 sola entrada (`79123456`). Añadir cédulas placeholder futuras al set no requiere migración ni cambios de código adicionales — Parte B lo lee dinámicamente.

## 6. Notas de packaging

`recomputeScalarCoherenceForGating` vive lógicamente en `procesar-cancelacion/index.ts` porque consume `CancelacionData` (tipo local del edge function). Los tests Vitest en `src/shared/` no pueden importar desde `supabase/functions/procesar-cancelacion/` (fuera del alias `@shared`).

**Dos opciones a decidir:**
- **6a**: exportar la función desde `index.ts` y escribir el test Vitest importándola vía path relativo (los test files ya lo hacen para `mergeRegenPayload` — ver `src/shared/mergeRegenPayload.test.ts` importando desde `../../supabase/functions/_shared/isomorphic/`). El código nuevo NO vive en `_shared/isomorphic/` porque depende del tipo `CancelacionData`. Test importaría desde `../../supabase/functions/procesar-cancelacion/index.ts`.
- **6b**: portar la función a `_shared/isomorphic/scalarGatingRecompute.ts` recibiendo `poder_banco: unknown, partes: {banco_nit?, banco_acreedor?}` (tipos amplios, no `CancelacionData`). Más limpio, sigue la política del proyecto de "isomórfico en `_shared/`". Preferida.

Recomendación: **6b**. Ganancia: `recomputeScalarCoherenceForGating` queda testeable desde Vitest sin gimnasia de imports cross-tree, y sigue la regla del skill `blindaje-poder-bancario` de que código isomórfico vive siempre en `_shared/isomorphic/`.

## 7. Orden de implementación (cuando aprobado)

1. Crear `_shared/isomorphic/scalarGatingRecompute.ts` con la función + export `SCALAR_COHERENCE_GATING_CODES`.
2. Ampliar `hardBlockRules.ts`: entrada Parte B + predicado `isCedulaEditadaValidaNoPlaceholder`.
3. Editar `procesar-cancelacion/index.ts` — 4 líneas dentro de `detectRequiereRevisionManual` + import de `recomputeScalarCoherenceForGating`.
4. Escribir 2 tests nuevos (funcional + cobertura).
5. Correr `bunx vitest run` + `deno test` completos. Confirmar cero regresión en los 350/95 existentes.
6. Diff completo al final.

## Anti-ejemplos añadidos al skill (post-merge)

- ❌ Usar `isCedulaEditadaValida` sola como predicado de supresión para `apoderado_cedula_placeholder` — permite desbloquear con la misma cédula placeholder (H1). Usar `isCedulaEditadaValidaNoPlaceholder` que además cruza contra `PODER_CEDULAS_PLACEHOLDER`.
- ❌ Persistir el resultado del recálculo escalar de vuelta a `_coherencia_warnings`. Rompe el contrato "la persistencia solo se actualiza en un pipeline OCR real" y puede borrar por accidente warnings de otros validadores anotados en el mismo array.
- ❌ Agregar un código escalar nuevo (`_incoherente`, `_no_legible` de coherencia) sin: (a) agregarlo a `SCALAR_COHERENCE_GATING_CODES` o `MANUAL_OVERRIDE_RULES`, (b) tener el emisor en un archivo puro isomórfico. El test de cobertura Aserción 2 debería atrapar la omisión.