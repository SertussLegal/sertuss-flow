
# Regla 7 — confianza en 4 campos profundos del poder bancario

Capturar el nivel de confianza que Gemini ya calcula (pero hoy descartamos) para 4 campos profundos, y usarlo para detectar "alucinación confiada" (valor incorrecto pero consistente entre menciones → Reglas 5/6 no lo detectan). Advertencia ámbar, no hard-block.

## 0. Cuestiones resueltas con evidencia

### Q1 — Contrato de `PoderBancoDeepPayload` para los 4 campos

Hoy, en `index.ts:39-64` estos 4 paths se tipan como **string plano**:
- `apoderado.cedula: string | null`
- `poderdante.representante_legal_cedula: string | null`
- `instrumento_poder.escritura_num: string | null`
- `instrumento_poder.fecha: string | null`

Los 8 campos legacy planos (`apoderado_cedula`, `escritura_poder_num`, `fecha_poder`, ...) ya son `{valor, confianza}` y ya pasan por `unwrapConf` — funciona.

### Q2 — CRÍTICO: quiénes leen los 4 paths profundos como string plano

Enumerado con `rg`, los readers que asumen string plano son:

| Archivo | Uso |
|---|---|
| `supabase/functions/procesar-cancelacion/index.ts:1058,1307-1314,1335` | `pb.instrumento_poder.escritura_num`, `pb.apoderado.cedula`, `poderdante.representante_legal_cedula` para `Nully paths`, docx vars y coherencia |
| `supabase/functions/_shared/isomorphic/apoderadoClassifier.ts:75,160` | `ctx.instrumento_poder.escritura_num/fecha` para clasificar tipo |
| `supabase/functions/_shared/isomorphic/prosaBancos/davivienda.ts:52,68,74,94,103` | `ctx.apoderado.cedula`, `ctx.poderdante.representante_legal_cedula` para prosa |
| `supabase/functions/_shared/validatePoderSuficiencia.ts:114` | `poder.instrumento_poder.fecha` |
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts:252-262` | `deepV6.instrumento_poder.escritura_num/fecha`, `apoderadoIn.cedula` para NO_LEGIBLE override |
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts:209-212` | Regla 5, Regla 6, Reglas 2.1/2.2/2.3, Regla 3 |
| `supabase/functions/_shared/isomorphic/prosaBancos/types.ts:64,102` + `mergeOverride.ts` + `overrideSchema.ts` | Persistencia de override manual (contract) |
| `src/lib/buildProsaContext.ts:55` | Contexto prosa cliente |
| `src/components/cancelaciones/PoderViewerTab.tsx:39` | UI viewer |
| `src/pages/CancelacionValidar.tsx:1474` | Input campo RL cédula |
| `src/pages/Validacion.tsx:3225` + `PersonaForm.tsx:231` + `DocxPreview.tsx:400,645` + `types.ts:68,179` | Trámites (rama distinta, no toca poder banco pero comparte nombre de campo) |
| `descubrir-reglas/_patterns.ts:49` | Auditor offline |

**Migrar el schema y el tipo a `{valor, confianza}` en estos 4 paths tocaría todos estos consumidores** — es cambio invasivo, propenso a regresión, y viola el instinto conservador de la Regla 6 anterior (donde agregamos `menciones_cedula[]` sin tocar el escalar `cedula`).

### Q3 — Decisión de diseño: **sidecar, no wrapper**

En lugar de cambiar el tipo de los 4 campos profundos, el patrón elegido es idéntico al que ya usan las menciones (evidencia forense hermana, no reemplazo del escalar):

1. **Schema (`tool.ts`)** — envolver los 4 campos con `confField(...)` (idéntico a los 8 legacy). Los prompts de Gemini ya usan este patrón, así que el modelo ya sabe emitirlo. Descripciones intactas (incluyendo NO_LEGIBLE donde aplica).

2. **Tipo (`index.ts`)** — cambiar los 4 tipos a `{ valor?: string | null; confianza?: "alta"|"media"|"baja" } | null`.

3. **Merge (`merge.ts`)** — en `mergePoderBancoV6`, **antes** de retornar, aplicar `unwrapConfDeep` sobre los 4 paths del bloque profundo, colapsándolos a string plano en el mismo lugar donde hoy Gemini los emitiría. Los consumidores downstream (index.ts:1307, davivienda.ts, classifier.ts, ...) **siguen viendo string plano** — cero cambio en readers.

4. **Sidecar `_confianza`** — mismo `mergePoderBancoV6` emite además un mapa nuevo `_confianza: Record<string, "alta"|"media"|"baja">` con las llaves de los 4 paths (más los 4 legacy planos si están disponibles, "gratis" porque ya existen). Vive junto a `_classifier_motivos` en el output.

5. **Validate (`validate.ts`)** — nueva Regla 7 lee `merged._confianza[path]`. Si `=== "baja"` y el campo tiene valor no vacío → warning + suspicious (mismo `Set` que Reglas 5/6). Excepción Manual>OCR idéntica.

### Q4 — Retrocompatibilidad con cancelaciones históricas

Registros en BD guardados antes del schema nuevo no tendrán wrapper. Efectos:

- **En Gemini**: los prompts nuevos piden wrapper; si el modelo devuelve string plano (fallback poco probable), `unwrapConfDeep` lo trata como `valor: <str>, confianza: undefined` → sidecar omite ese path → Regla 7 no dispara. **No hay crash.**
- **En BD**: `data_ia`/`data_final` viejos: `_confianza` ausente → validate lee `undefined` → Regla 7 no dispara. **No hay crash, no hay falso positivo, no hay migración.**
- **En regen**: `mergeRegenPayload` deep-merge `apoderado`/`poderdante`/`instrumento_poder`. El escalar `cedula`/`escritura_num`/... sigue siendo string plano tras el merge (porque el pipeline los aplanó). El sidecar `_confianza` se recalcula en cada corrida OCR nueva, no se persiste como fuente de verdad — es señal transitoria. **No requiere merge especial.**

### Q5 — UI: ¿falta algo?

`CancelacionValidar.tsx` ya conecta los 4 `Field` (nombre / cédula / N° escritura / fecha del poder) al mismo `Set` unificado (sesión anterior). Regla 7 alimenta ese mismo Set con nombres de warning distintos → borde ámbar + `suspiciousLabel` aparece automáticamente. **No requiere cambio de UI.** El único ajuste es agregar entradas en `WARNING_LABELS` para los 4 nuevos códigos.

---

## 1. Archivos y orden de edición

1. `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` — envolver 4 propiedades con `confField(...)` (preservando descripción + NO_LEGIBLE).
2. `supabase/functions/_shared/isomorphic/poderBancoExtractor/index.ts` — cambiar el tipo TS de los 4 paths a `{valor,confianza}|null`.
3. `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts`:
   - Añadir helper `unwrapConfDeep(v): {valor?: string, confianza?: "alta"|"media"|"baja"}` (no rompe `unwrapConf` existente).
   - En `mergePoderBancoV6`: antes de armar `out`, aplanar los 4 campos profundos de `deepV6` a string plano (para que `apoderadoIn.cedula`, `deepV6.instrumento_poder.escritura_num`, etc., sigan comportándose como hoy en downstream).
   - Construir sidecar `_confianza` con hasta 8 entradas (4 profundos + 4 planos legacy).
   - Añadir `_confianza` al `out`.
4. `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts`:
   - Añadir 4 entradas a `WARNING_LABELS`: `apoderado_cedula_confianza_baja`, `poderdante_rl_cedula_confianza_baja`, `escritura_poder_confianza_baja`, `fecha_poder_confianza_baja`. Todas ámbar-informativas, texto tipo "Gemini reportó confianza baja en …".
   - Añadir Regla 7 al final de `validatePoderBancoCoherencia`, antes del return. Recorre 4 tuplas `[warningCode, path, escalarActual]`. Si `_confianza[path] === "baja"` y el escalar no está vacío ni ausente → warning + `suspicious.add(path)`. Excepción Manual>OCR: si `opts.manualReviewConfirmed` y el escalar tiene formato válido (para cédulas: `isCedulaValida`; para escritura: `extractEscrituraDigits`; para fecha: `extractYear`), suprimir warning pero **preservar** el dato en el sidecar.
5. Confirmar que **NINGUNO** de los 4 sufijos de warning coincide con `HARD_BLOCK_WARNING_SUFFIXES` (`_no_legible`, `_incoherente`, `_placeholder`, `_duplicidad_cruzada`, `_menciones_incoherentes`). El sufijo elegido `_confianza_baja` es nuevo y NO cae en ninguno → automáticamente NO bloquea. Cero cambio en `HARD_BLOCK_WARNING_SUFFIXES`.
6. Tests nuevos: `src/shared/poderBancoValidateConfianzaBaja.test.ts` — 8 casos:
   - Cada uno de los 4 campos con `confianza=baja` → warning + suspicious del path correcto.
   - `confianza=media` o `=alta` → no dispara.
   - Sidecar ausente (registro histórico) → no dispara.
   - Excepción Manual>OCR con escalar corregido → suprime warning, `_confianza` intacto.
   - Escalar vacío/ausente + confianza baja → **no dispara** (Gemini no leyó nada, no hay nada sospechoso).
   - Contrato: `isHardBlockCoherenciaWarning("apoderado_cedula_confianza_baja") === false`.
7. Verificar regresión: `poderBancoExtractor.test.ts`, `poderBancoValidate.test.ts`, `poderBancoValidateMencionesRL.test.ts`, `poderBancoValidateMencionesApoderado.test.ts`, `certificadoInmuebleValidate.test.ts`, `mergeRegenPayload.test.ts`, `apoderadoClassifier.test.ts` — todos deben seguir verdes sin modificarse. En particular, el test existente `mergePoderBancoV6 → Ana María NO_LEGIBLE override` debe pasar porque `unwrapConfDeep` produce string plano `"NO_LEGIBLE"` idéntico al comportamiento actual de `unwrapConf`.

## 2. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Downstream lee `apoderado.cedula` como objeto** (crash `.replace` en davivienda.ts, classifier.ts, index.ts:1307...) | `merge.ts` aplana los 4 profundos ANTES de emitir `out.apoderado/poderdante/instrumento_poder`. Los consumidores siguen viendo string. Tests de merge (`poderBancoExtractor.test.ts`) cubren esto. |
| **Dato histórico BD sin wrapper** | `unwrapConfDeep` acepta string plano O `{valor,confianza}` (mismo pattern de `unwrapConf`). Sidecar omite path con confianza undefined. Regla 7 lee sidecar → no dispara. |
| **Gemini emite `confianza=baja` en vacío** | Guard: warning solo si escalar tiene valor no vacío. Evita ruido visual. |
| **Regla 7 se vuelve hard-block por accidente** | Sufijo `_confianza_baja` no está en `HARD_BLOCK_WARNING_SUFFIXES`. Test contrato explícito. |
| **`mergeRegenPayload` borra `_confianza`** | `_confianza` no vive dentro de `apoderado`/`poderdante`/`instrumento_poder` — es hermano top-level. Deep-merge existente no lo toca. Si en un regen el usuario NO reenvía OCR, `_confianza` de la corrida anterior se preserva (comportamiento correcto: si no hay OCR nuevo, la confianza previa sigue vigente). |
| **Prosa/docx recibe el escalar aplanado que puede ser `""` cuando Gemini devuelve `{valor:"", confianza:"baja"}`** | `unwrapConfDeep` retorna `undefined` para valor vacío/nully (idéntico a `sanitizeString`). Mismo comportamiento actual. |

## 3. Fuera de alcance

- No se modifican los 8 legacy planos (ya usan `confField` desde v6).
- No se agrega Regla 7 para menciones (`menciones_rl[]`, `menciones_cedula[]`) — su confianza no se persiste hoy y no es prioridad.
- No se toca UI: los `Field` del apoderado ya reciben `suspicious` del `Set` unificado (sesión anterior).
- No se toca `HARD_BLOCK_WARNING_SUFFIXES` — Regla 7 es informativa por diseño.
- No se toca schema ni edge de `procesar-cancelacion` (index.ts) — sigue leyendo escalares planos.

## 4. Anti-ejemplos evitados

- ❌ Envolver los 4 campos y forzar a los 20+ readers a llamar `unwrapConf`.
- ❌ Persistir `_confianza` en BD como fuente de verdad — es señal transitoria del OCR, se recalcula.
- ❌ Meter `_confianza_baja` en hard-block — el modelo puede reportar "baja" en campos legibles pero raros. Solo advierte.
- ❌ Migración de datos históricos — sidecar ausente = silencio, comportamiento seguro.
