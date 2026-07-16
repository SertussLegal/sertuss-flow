# Blindaje dirección catastral + matrícula inmobiliaria — Fase 1 (intra-documento)

Caso ancla: escritura 7058, matrícula 50C-1572091. OCR emitió "13C-09" (transposición) donde el certificado real dice "KR 104 13C-05 CA 119". Este plan replica el patrón `menciones_rl` → validación determinista → hard-block, exactamente como se blindó el RL del banco.

> Nota: este plan es idéntico al que ya fue aprobado e implementado en el turno anterior (10 tests nuevos verdes + 55 de regresión intactos). Se re-emite sin cambios por estar de vuelta en plan mode.

---

## Preguntas respondidas con evidencia del código

**1. ¿El certificado siempre repite dirección/matrícula en ≥2 lugares?**
No siempre. La matrícula aparece habitualmente en el encabezado y en el pie de cada anotación (típicamente ≥3 menciones), pero un certificado corto y limpio puede traer una sola instancia legible. La dirección tiene un caso legítimo de mención única: el prompt actual (`certificadoTradicion/prompt.ts` regla especial `inmueble.direccion`, y `procesar-cancelacion/index.ts:212` en la versión monolítica) admite explícitamente "solo hay un renglón sin numerar, tómalo". Por tanto la regla debe **tolerar 1 sola mención sin disparar** — mismo criterio que Regla 5 (`poderBancoValidateMencionesRL.test.ts` caso 3).

**2. ¿Existe ya normalización reusable?**
Sí, dos utilidades vivas hay que reutilizar en el comparador:
- `sanitizeMatricula(...)` en `procesar-cancelacion/index.ts:1072`.
- `sanitizeNomenclaturaBase(...)` del skill `direccion-completa-saneada-cancelacion` (Fase A: strip catastral, strip ciudad, "GUION"→"-", colapso de espacios).

**3. ¿Afecta al extractor de escritura antecedente / intra-trámite?**
No. `supabase/functions/scan-document/core/escrituraAntecedente/tool.ts` sólo tiene `linderos_*`, `numero_escritura`, `fecha`, `notaria`, `tipo_acto`, `comparecientes[]` — **no** hay `direccion` ni `matricula` del inmueble. La coherencia es **intra-documento** dentro del certificado. No hace falta módulo intra-trámite.

**Bonus — dónde vive el extractor real de cancelaciones:**
`procesar-cancelacion/index.ts` **no** llama a `scan-document/certificadoTradicion/*`. Tiene su propio schema monolítico inline con `inmueble.matricula_inmobiliaria`, `nomenclatura_predio`, `descripcion_predio` (líneas 207-218). Por tanto el prompt/tool a extender es el de `procesar-cancelacion`.

---

## Parte A — Campo redundante en el schema

Extender `procesar-cancelacion/index.ts` schema `inmueble` con:

```ts
menciones_direccion: {
  type: "array",
  description: "TODAS las menciones INDEPENDIENTES de la dirección catastral tal como aparecen literalmente en el certificado, ANTES de aplicar la regla de índice más alto o de reformatear. Una entrada por renglón numerado del bloque 'DIRECCION DEL INMUEBLE'. Si solo hay un renglón, emite 1 sola entrada. NO reemplaza a nomenclatura_predio.",
  items: {
    type: "object",
    properties: {
      seccion: { type: "string" },
      valor: { type: "string" },
      pagina: { type: "number" },
    },
    required: ["seccion", "valor"],
    additionalProperties: false,
  },
},
menciones_matricula: { /* mismo shape, transcripción literal de cada aparición del número de matrícula */ },
```

Estructura tomada como espejo de `menciones_rl` en `poderBancoExtractor/tool.ts`.

**Prompt** — nuevo bloque "BLINDAJE ANTI-TRANSPOSICIÓN" antes del cierre `Llama SIEMPRE a la herramienta…`:

```
Antes de emitir inmueble.nomenclatura_predio, transcribe ADEMÁS en
inmueble.menciones_direccion[] cada mención de dirección catastral tal
como aparece LITERALMENTE en el bloque "DIRECCION DEL INMUEBLE" — sin
reformatear, sin verbalizar, sin reordenar.

Antes de emitir inmueble.matricula_inmobiliaria, transcribe en
inmueble.menciones_matricula[] cada aparición literal del número de
matrícula (encabezado + pie de anotaciones relevantes).

Objetivo: permitir al backend detectar transposiciones de dígitos.
Emite honestamente; si solo hay una mención legible, emite una.
```

---

## Parte B — Módulo de validación

Nuevo archivo isomórfico: `supabase/functions/_shared/isomorphic/certificadoInmuebleValidate.ts`.

- Exporta `validateInmuebleCoherencia(inmueble)` → `{warnings, suspicious}`.
- Normalizadores dedicados (uppercase, strip catastral, "GUION"→"-", colapso de espacios/puntuación para dirección; strip puntos/espacios/guiones para matrícula).
- Warnings:
  - `inmueble_direccion_menciones_incoherentes`
  - `inmueble_matricula_menciones_incoherentes`
- Ambos terminan en `_menciones_incoherentes` → **ya cubiertos** por `HARD_BLOCK_WARNING_SUFFIXES` (line 78 de `poderBancoExtractor/validate.ts`). **Cero migración de constantes.**
- Tolera 1 sola mención sin disparar. NO_LEGIBLE parcial se ignora (mismo criterio Regla 5).

### Wiring en `procesar-cancelacion/index.ts`

1. Import de `validateInmuebleCoherencia`.
2. Nueva función `annotateInmuebleCoherencia(supabase, inmueble, ctx)` análoga a `annotatePoderCoherencia`, escribe `_coherencia_warnings`/`_coherencia_suspicious` sobre `extracted.inmueble` y emite `system_event` `procesar-cancelacion.inmueble.coherencia`.
3. Llamarla en el pipeline en vivo justo después del bloque de anotación del poder.
4. `detectRequiereRevisionManual`: sumar `extracted.inmueble._coherencia_warnings` al filtro `motivos.filter(isHardBlockCoherenciaWarning)`.

### UI (labels)
Agregar en `poderBancoExtractor/validate.ts`:
- `WARNING_LABELS`: 2 entradas (dirección/matrícula incoherentes).
- `SUSPICIOUS_FIELD_LABELS`: 4 entradas (`inmueble.menciones_direccion`, `inmueble.nomenclatura_predio`, `inmueble.menciones_matricula`, `inmueble.matricula_inmobiliaria`).

---

## Tests de regresión

Nuevo `src/shared/certificadoInmuebleValidate.test.ts` (10 casos):

1. Caso ancla real 7058 (13C-05 x2 + 13C-09 x1) → dispara dirección + hard-block.
2. 3 menciones consistentes → no dispara.
3. 1 sola mención → no dispara.
4. Formato dirección (espacios / `-` vs `- ` vs sin guion) → no dispara.
5. Matrícula 1572091 vs 1572081 → dispara.
6. Matrícula solo formato distinto (`50C-…` vs `50C …` vs `50C…`) → no dispara.
7. NO_LEGIBLE parcial + resto consistente → no dispara.
8. Contrato hard-block (`isHardBlockCoherenciaWarning` reconoce ambos códigos nuevos).
9. Payload legacy sin `menciones_*` → no dispara.
10. Normalizadores exportados funcionan aislados.

---

## Archivos afectados

1. `supabase/functions/procesar-cancelacion/index.ts` — schema, prompt, import, `annotateInmuebleCoherencia`, wiring en live pipeline, extensión de `detectRequiereRevisionManual`.
2. **Nuevo**: `supabase/functions/_shared/isomorphic/certificadoInmuebleValidate.ts`.
3. `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts` — sólo labels (WARNING_LABELS + SUSPICIOUS_FIELD_LABELS). **No** tocar `HARD_BLOCK_WARNING_SUFFIXES`.
4. **Nuevo**: `src/shared/certificadoInmuebleValidate.test.ts`.

### Fuera de alcance (Fase 2)
Extender el mismo patrón a `scan-document/certificadoTradicion/tool.ts` (compraventa). Estructura idéntica pero requeriría wiring paralelo en `process-expediente`. No se toca aquí — el bug ancla es de cancelaciones.
