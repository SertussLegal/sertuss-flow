# Diagnóstico: coherencia intra-trámite entre poder, escritura y certificado

**Solo investigación — no se cambia código.** Este es el terreno actual y una propuesta de dónde debería vivir el chequeo si se decide construirlo.

---

## 1. ¿Existe hoy el cruce entidad-otorgante del poder ↔ acreedor hipotecario?

**No. En ningún archivo.**

`validate.ts` (`supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts:137-277`) ejecuta 5 reglas — todas sobre el `poder_banco` mergeado **en aislamiento**. Su firma es `validatePoderBancoCoherencia(merged)` y solo recibe el objeto poder; nunca ve `partes.banco_nit`, `partes.banco_acreedor` ni datos de la escritura/certificado.

Los campos necesarios para el cruce **sí existen** en la data ya extraída:

- `poder_banco.poderdante.entidad_nit` / `entidad_nombre` — banco que otorga el poder (`poderBancoExtractor/tool.ts:60-66`).
- `partes.banco_acreedor` + `partes.banco_nit` — acreedor real, extraído por la llamada monolítica de `procesar-cancelacion` desde escritura/certificado (`procesar-cancelacion/index.ts:238-239`).
- `certificadoTradicion.actos.entidad_bancaria` + `actos.entidad_nit` — presente en el schema OCR del certificado (`certificadoTradicion/tool.ts:80-81`).

**Pero ningún código los compara entre sí dentro del mismo trámite.**

## 2. ¿Existe hoy el cruce apoderado ↔ quien firma/gestiona en la escritura o certificado?

**No.** `reconcileData.ts` (`src/lib/reconcileData.ts:207-288`) reconcilia personas naturales (deudores/comparecientes) entre cédulas, escritura y certificado usando CC como clave — jamás cruza la identidad del apoderado del poder contra ninguno de los otros dos documentos. `validatePoderSuficiencia.ts` valida facultades/vigencia del poder aisladamente (`_shared/validatePoderSuficiencia.ts:75-144`).

## 3. ¿`crossCheck.ts` cubre este caso?

**No — `crossCheck.ts` es explícitamente ENTRE cancelaciones distintas** de la misma organización (`crossCheck.ts:1-13, 57-96`). Sus 2 reglas (`apoderado_nombre_duplicidad_cruzada`, `apoderado_cedula_duplicidad_cruzada`) toman el poder actual y lo comparan contra ~500 filas de OTRAS cancelaciones. Cero lógica intra-trámite.

## 4. ¿Dónde se combinan hoy los 3 documentos?

En `procesar-cancelacion/index.ts`, la llamada monolítica a Gemini con la herramienta `extract_cancelacion_hipoteca` (líneas 162-283) ya recibe las páginas de los 3 documentos y produce en el mismo `extracted`: `partes.banco_acreedor/banco_nit` (desde certificado/escritura) y `poder_banco.*` (desde páginas del poder). Después del merge (línea 2744-2758) se llaman `annotatePoderCoherencia()` y `runPoderCrossChecks()` — **ambas reciben solo `mergedPoder`** y son ciegas a `extracted.partes.*` y `extracted.hipoteca_anterior.*`. El punto de fusión de datos existe; el punto de cruce no.

---

## Confirmación explícita

Un poder auténtico, internamente coherente (pasa Regla 5, sin NO_LEGIBLE, cédulas bien formadas, sin duplicidad cruzada entre cancelaciones), que autorice sobre BANCO A cuando la escritura de esta cancelación tiene como acreedor a BANCO B — **hoy pasa sin ningún warning**. No hay defensa contra este escenario.

---

## Propuesta de ubicación (para cuando se decida construir Fase 2 intra-trámite)

Dos opciones limpias, ambas viables:

**Opción A — Nuevo módulo isomórfico `validateIntraTramite.ts` en `_shared/isomorphic/poderBancoExtractor/`.**
Firma: `validatePoderVsCancelacion(merged, partes: { banco_nit, banco_acreedor })` → devuelve el mismo `CoherenciaResult` (warnings + suspicious) que `validatePoderBancoCoherencia`. Pure TS, unit-testable desde Vitest sin Deno. Mantiene separación de responsabilidades: `validate.ts` = intra-poder, `validateIntraTramite.ts` = poder ↔ resto del trámite, `crossCheck.ts` = poder ↔ otras cancelaciones.

**Opción B — Extender `annotatePoderCoherencia()` en `procesar-cancelacion/index.ts:1414-1440`.**
Ya vive donde `extracted.partes.*` está en scope. Menor superficie de cambio, pero mezcla orquestación con lógica de validación y no es testeable con Vitest (es Deno edge).

**Recomendación: Opción A** — coherente con el patrón que ya existe (Regla 5 se hizo isomórfica precisamente para tests). El orquestador la llama junto a `validatePoderBancoCoherencia` y `detectDuplicidadCruzada`, y sus warnings entran al mismo `_coherencia_warnings` y a `HARD_BLOCK_WARNING_SUFFIXES` si se decide que deben bloquear (por ejemplo, sufijo `_entidad_incoherente`).

**Reglas candidatas** (a diseñar en un plan aparte si se aprueba construir):

1. `poder_entidad_nit_incoherente` — `normalizarNit(poderdante.entidad_nit)` ≠ `normalizarNit(partes.banco_nit)` cuando ambos están presentes.
2. `poder_entidad_nombre_incoherente` — comparación fuzzy de `entidad_nombre` vs `banco_acreedor` (fallback si falta un NIT).
3. Considerar también `certificadoTradicion.actos.entidad_nit` como segunda fuente de verdad del acreedor (Smart Fallback igual que el chequeo de notaría origen).

---

## Fuera de alcance de este diagnóstico

- No se propone aún qué sufijo usar, si es HARD_BLOCK o warning suave, ni la lógica de fuzzy match.
- No se propone Fase 3 (backfill retroactivo).
- No se toca código.

Si querés que arme el plan formal de construcción con reglas exactas, tests y ubicación final, decímelo y lo redacto en Plan mode antes de pasar a Build.
