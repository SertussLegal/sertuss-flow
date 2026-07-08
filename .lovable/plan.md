
# Plan — Canal formal de "no legible" para campos críticos del poder bancario

## Contexto y causa raíz

Caso real (Ana María, cancelación `2fb6ba16-…`, 08-jul-2026 00:47 UTC):
- Cédula OCR: `41525143` — Cédula real: `41.939.243` → **alucinada**.
- Escritura plano: `8354` / profundo: `7304` → Parte 2 la detectó (`escritura_num_incoherente`).
- La cédula pasó porque cumple formato colombiano y no colisiona con RL del banco.

Causa: el schema V6 y el prompt obligan a devolver *siempre* un string en `apoderado.cedula`, `apoderado_cedula` (plano), `instrumento_poder.escritura_num`, `apoderado_escritura`, `instrumento_poder.fecha`, `apoderado_fecha`. Cuando la imagen está borrosa, el modelo prefiere inventar antes que declarar incertidumbre — el prompt lo permite implícitamente porque solo hay `confianza: "baja"` (ignorada rio abajo) y `null` documentado para campos ausentes, no para campos ilegibles.

Alcance del plan: los **3 campos críticos** del apoderado natural / instrumento del poder:
1. `apoderado.cedula` + `apoderado_cedula` (legacy plano)
2. `instrumento_poder.escritura_num` + `apoderado_escritura` (legacy plano)
3. `instrumento_poder.fecha` + `instrumento_poder.fecha_texto` + `apoderado_fecha` (legacy plano)

No se tocan: sociedad apoderada (jurídica), representantes, poderdante, facultades, vigencia, anexos. Reduce superficie de regresión y esos campos ya tienen fallback cruzado (`representantes[]`, `poderdante.*`).

## Parte 1 — Schema: canal formal `"NO_LEGIBLE"`

**Decisión de forma:** no cambiar tipos (mantener `type: "string"`). Introducir centinela textual `"NO_LEGIBLE"` reservado. Alternativa (nullable) rechazada porque:
- El JSON schema del gateway ya trata `null` como "no lo pongas", y hoy el modelo lo interpreta como "no aparece en el documento" (ausencia legítima) vs. lo que necesitamos ("aparece pero no puedo leerlo con certeza"). Son estados semánticamente distintos.
- Un centinela textual sobrevive al passthrough del gateway y al merge V6 (`merge.ts`) sin cambios de tipo.
- `validate.ts` puede detectarlo con un `=== "NO_LEGIBLE"` trivial.

**Cambios en `tool.ts` (descriptions, no estructura):**
- `apoderado_cedula` (legacy): añadir `"Si el número aparece pero está borroso / tachado / cortado y no puedes leerlo con certeza total, devuelve exactamente 'NO_LEGIBLE' (no inventes dígitos plausibles)."`
- `apoderado.cedula` (profundo, línea 89): idem.
- `instrumento_poder.escritura_num` (137) y `apoderado_escritura` NO existe como legacy — usar `escritura_poder_num` (39): idem.
- `instrumento_poder.fecha` (138), `instrumento_poder.fecha_texto` (139), `fecha_poder` (40): idem.

No se cambia `required`, no se cambia `enum`, no se cambia `additionalProperties`. `has_apoderado_banco_v3` sigue igual.

## Parte 2 — Prompt: guardar contra sobre-uso de NO_LEGIBLE

**Añadir bloque nuevo al final del prompt, antes de "ANTI-ALUCINACIÓN":**

```
═══════════════════════════════════════════════════════════════════════════════
CANAL "NO_LEGIBLE" (SOLO 3 CAMPOS CRÍTICOS — usar con parsimonia)
═══════════════════════════════════════════════════════════════════════════════

APLICA EXCLUSIVAMENTE a estos 3 campos y sus equivalentes planos:
  - Cédula del apoderado (apoderado.cedula + apoderado_cedula)
  - Número de escritura del poder (instrumento_poder.escritura_num + escritura_poder_num)
  - Fecha del poder (instrumento_poder.fecha + fecha_poder + fecha_texto)

REGLA: si el campo APARECE en el documento pero está borroso, tachado,
cortado por el margen, tapado por un sello o con dígitos ambiguos que
NO puedes resolver con certeza, devuelve LITERALMENTE la cadena
"NO_LEGIBLE" (sin comillas, mayúsculas exactas) en el campo, con
confianza "baja".

NO uses NO_LEGIBLE cuando:
  - El campo simplemente no aparece en las páginas → usa null como siempre.
  - Puedes leer el valor con confianza "alta" o "media" → devuelve el valor.
  - Solo tienes DUDA MENOR sobre 1 dígito de la cédula pero contexto
    (nombre, expedición, firma) confirma la identidad → devuelve el valor
    con confianza "baja". NO_LEGIBLE es para ilegibilidad, no para duda leve.

FILOSOFÍA: preferimos que la UI pida verificación humana a que firmes
una cancelación con una cédula inventada. Pero abusar de NO_LEGIBLE
degrada la utilidad del sistema — úsalo solo cuando genuinamente no
puedas leer.
```

**Ajuste al bloque ANTI-ALUCINACIÓN existente:** añadir línea `- Para los 3 campos críticos, ver bloque "CANAL NO_LEGIBLE" arriba — NO_LEGIBLE reemplaza a null cuando el texto aparece pero es ilegible.`

## Parte 3 — `validate.ts`: 3 warnings nuevos

Añadir a `WARNING_LABELS`:
```ts
apoderado_cedula_no_legible:
  "El OCR marcó la cédula del apoderado como no legible — verifícala manualmente contra el documento original antes de firmar.",
escritura_poder_no_legible:
  "El OCR marcó el número de escritura del poder como no legible — verifícalo manualmente.",
fecha_poder_no_legible:
  "El OCR marcó la fecha del poder como no legible — verifícala manualmente.",
```

Añadir función `isNoLegible(v)` → `v === "NO_LEGIBLE"`.

Añadir al final de `validatePoderBancoCoherencia`, antes del `return`:
```ts
// Regla 3 — Campos críticos marcados como no legibles por el OCR.
const noLegibleChecks: Array<[string, string[], string]> = [
  ["apoderado_cedula_no_legible",
    ["apoderado_cedula", "apoderado.cedula"],
    [apoderadoCedulaPlano, apoderadoCedulaDeep]],
  ["escritura_poder_no_legible",
    ["escritura_poder_num", "instrumento_poder.escritura_num", "apoderado_escritura"],
    [merged.escritura_poder_num, instrEscritura, apoderadoEscritura]],
  ["fecha_poder_no_legible",
    ["fecha_poder", "instrumento_poder.fecha", "instrumento_poder.fecha_texto", "apoderado_fecha"],
    [merged.fecha_poder, instrFecha, instr?.fecha_texto, apoderadoFecha]],
];
// (marca warning si CUALQUIER path contiene NO_LEGIBLE; añade solo los paths afectados a suspicious)
```

Añadir labels correspondientes a `SUSPICIOUS_FIELD_LABELS`.

## Parte 4 — `PoderBannersV5.tsx`: mensajes humanos

Ya existe el banner ámbar de `_coherencia_warnings` (implementado en la ronda anterior). Solo requiere:
- Confirmar que los 3 nuevos códigos aparecen en `WARNING_LABELS` (arriba) para que el banner los renderice con texto humano automáticamente.
- Opcional (min. incremento): dar prioridad visual al mensaje "no legible" (ícono ⚠️ + texto rojo suave) vs. incoherencia interna (ámbar). **Recomendación: dejar todo ámbar en esta fase** para no reabrir el diseño del banner; los códigos con `_no_legible` ya son suficientemente descriptivos.

## Parte 5 — Merge V6 (`merge.ts`): pasar NO_LEGIBLE tal cual

Auditoría necesaria (no cambios de código todavía): confirmar que `merge.ts` propaga strings arbitrarios sin filtrar `NO_LEGIBLE`. Si `merge.ts` tiene lógica tipo "si plano vacío usar profundo o viceversa", verificar que `NO_LEGIBLE` no se trate como "vacío" y sea sobreescrito por un valor real del otro bloque. **Este es el mayor riesgo silencioso de la Parte 5**: si merge trata `NO_LEGIBLE` como "hay dato", perfecto; si lo trata como "no hay dato" y hace fallback al bloque contrario que sí alucinó, perdimos la señal.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Modelo abusa de NO_LEGIBLE en documentos limpios → banners falsos → fatiga | Prompt tiene 3 "NO uses" explícitos + limitación a 3 campos + fixture de regresión con poder limpio que NO debe generar warnings |
| Merge V6 filtra `NO_LEGIBLE` como si fuera vacío | Auditar `merge.ts` en Parte 5 antes de implementar; añadir test unitario `merge` con NO_LEGIBLE en plano y valor real en profundo (y viceversa) |
| Downstream (docx generator, prosa Davivienda, hidratador) recibe "NO_LEGIBLE" como si fuera cédula real → cancelación firmada con texto "NO_LEGIBLE" | **CRÍTICO**: bloquear generación de minuta si algún campo crítico contiene NO_LEGIBLE. Añadir a `cancelacionCriticalFields.ts` o al pre-check de `procesar-cancelacion`. Decisión pendiente de aprobación: ¿bloqueo duro o solo warning ámbar? Recomendación → **warning ámbar + botón "Corregí manualmente, generar de todos modos"** consistente con filosofía "humano gana sobre IA". |
| Bump de `POWER_PROMPT_VERSION` invalida `ocr_raw_cache` → re-corre todos los OCRs de poderes en próximo procesar-cancelacion | Esperado y deseado: queremos que Ana María se re-procese con el nuevo prompt. Documentar en changelog. |
| Regresión en tests existentes (`poderBancoValidate.test.ts`, `poderBancoExtractor.test.ts`, `parity.test.ts`, snapshots) | Correr `bunx vitest run` completo; actualizar snapshot solo tras revisar diff |

## Fixtures de prueba

**Nuevos en `src/shared/poderBancoValidate.test.ts`:**
1. Cédula = `"NO_LEGIBLE"` en plano → warning `apoderado_cedula_no_legible`, suspicious `apoderado_cedula`.
2. `escritura_poder_num = "NO_LEGIBLE"` en plano, `instrumento_poder.escritura_num = "7304"` en profundo → warning `escritura_poder_no_legible` (paths afectados).
3. Fecha `NO_LEGIBLE` en `instrumento_poder.fecha_texto` → warning `fecha_poder_no_legible`.
4. **Caso Ana María (regresión de referencia):** payload con `apoderado_cedula: "41525143"` (formato válido, alucinado) → **sigue sin generar warning `apoderado_cedula_no_legible`** (Parte 2 no lo detecta — lo asumimos y documentamos). La única defensa es que el modelo con el nuevo prompt _decida_ devolver NO_LEGIBLE.
5. Poder limpio (fixture Bancolombia existente si hay, o sintético): todos los campos con valor real, cero warnings.

**Verificación en vivo (Parte 6):**
- Re-procesar el poder de Ana María contra la nueva versión del prompt (bump de `POWER_PROMPT_VERSION` invalida caché → se re-llama a Gemini).
- Verificar en `data_ia.poder_banco`: si Gemini ahora devuelve `NO_LEGIBLE` en cédula → éxito (`_coherencia_warnings` incluye `apoderado_cedula_no_legible`). Si sigue devolviendo `41525143` con confianza alta → el prompt no fue suficiente y necesitamos Parte 3 real (cross-check contra cédula del certificado de tradición u otra fuente independiente — fuera de este plan).
- Métrica cualitativa a los 3-5 poderes siguientes: contar cuántos disparan `_no_legible`. Si >50% de poderes limpios lo disparan → prompt demasiado agresivo, retroceder.

**Sin ground-truth automatizado:** honestamente, no podemos garantizar que Gemini haga lo correcto. El plan es aceptar que la mejora es probabilística y monitorear las primeras N cancelaciones tras el deploy.

## Fases de implementación (para próxima aprobación)

| Fase | Contenido | Archivos | Dependencia |
|---|---|---|---|
| A | Auditar `merge.ts` + añadir test unitario "NO_LEGIBLE no se degrada a vacío" | `merge.ts` (solo lectura), `poderBancoExtractor.test.ts` | Ninguna |
| B | Prompt + schema descriptions + bump `POWER_PROMPT_VERSION` a `v7-...` | `prompt.ts`, `tool.ts`, `poderBancoSchemaVersion.ts` | A |
| C | `validate.ts` nueva regla + labels + tests (incluye fixture Ana María) | `validate.ts`, `poderBancoValidate.test.ts` | A |
| D | Confirmar banner renderiza los 3 nuevos códigos (probable cero cambios en `PoderBannersV5.tsx`) | `PoderBannersV5.tsx` (verificación) | C |
| E | Decisión producto: `cancelacionCriticalFields.ts` — ¿bloqueo o warning en generación? Requiere aprobación humana explícita | `cancelacionCriticalFields.ts` | C, D |
| F | `bunx vitest run`, desplegar `procesar-cancelacion`, re-probar poder Ana María, reportar `_coherencia_warnings` en vivo | — | B, C, D |

**Fase E queda fuera de esta ronda** hasta decidir bloqueo vs. warning. Recomiendo aprobar A–D + F y dejar E para conversación separada.
