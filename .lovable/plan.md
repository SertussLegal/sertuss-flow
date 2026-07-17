## Evidencia recolectada (sin cambios de código)

### 1. `regla_propuesta_run` — no tiene campo `origen`
Columnas: `id, started_at, finished_at, status, disparado_por (CHECK ∈ manual|cron), triggered_by_user, tramites_analizados, propuestas_generadas, tokens_input, tokens_output, costo_estimado_usd, tiempo_ms, error_detalle, created_at, costo_estimado_cop`.

No hay forma de distinguir "corrida descubrir-reglas" vs "corrida auditor estático" sin migración.

### 2. Códigos de warning: NO exportados como listas
Los códigos existen solo como string literals en `warnings.push("…")`:
- `validate.ts`: 7 códigos hardcoded + generados por loop (`*_no_legible`, `*_confianza_baja`).
- `validateIntraTramite.ts`: 2 códigos (`poder_entidad_nit_incoherente`, `poder_entidad_nombre_incoherente`).

Único export: `HARD_BLOCK_WARNING_SUFFIXES` (5 sufijos) y `WARNING_LABELS` (dict UI, 27 keys).

### 3. Índice central
`WARNING_LABELS` es el índice más completo hoy, pero informal:
- No es contrato ("todo push está aquí").
- Sin test que garantice exhaustividad.
- Mezcla hard-block y soft (se deriva con sufijos).

`Object.keys(WARNING_LABELS).filter(isHardBlockCoherenciaWarning)` es la mejor fuente ejecutable.

---

## Decisiones que necesito confirmar antes de diseñar la arquitectura del auditor

**A. Almacenamiento de corridas del auditor estático**
- Opción A1: reutilizar `regla_propuesta_run` con `origen text` nuevo (migración: columna + CHECK ampliado + backfill 'descubrir_reglas').
- Opción A2: tabla propia `auditoria_hardblock_run` + `auditoria_hardblock_hallazgo` — mejor separación (los tokens/USD no aplican a análisis estático).

¿Cuál prefieres?

**B. Fuente de verdad de "códigos hard-block posibles"**
- Opción B1: aceptar `WARNING_LABELS` como fuente + agregar un test "todo `warnings.push('literal')` en validate*.ts tiene entrada en LABELS" (parseo estático simple del código, no runtime).
- Opción B2: crear array `WARNING_CODES: readonly string[]` en `validate.ts` / `validateIntraTramite.ts` como contrato formal, y refactorizar los `push` para usar constantes. Más invasivo.

¿B1 (más liviano) o B2 (más estricto)?

**C. Alcance del auditor**
¿Solo compara `hardBlockCodes(WARNING_LABELS)` vs `MANUAL_OVERRIDE_RULES[].warning` (detectar hard-blocks sin excepción Manual>OCR), o también otros invariantes (ej. "toda clave de WARNING_LABELS aparece emitida en algún warnings.push")?

Con tus respuestas te entrego un plan de implementación concreto.