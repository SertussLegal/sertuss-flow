# Auditoría: uso real de los .docx de referencia Davivienda

## Conclusión

**NO se usan en ningún pipeline de producción.** Son insumo de gobernanza/CI, no fuente en runtime.

## Evidencia (todas las referencias del repo)

Búsqueda `EJEMPLO_REFERENCIA_PROSA | EJEMPLO_REFERENCIA | referencia_prosa | referencia_davivienda`:

1. **`supabase/functions/audit-refs-davivienda/index.ts`** (líneas 22-23, 48) — endpoint interno con dos rutas:
   - `/hashes`: lista metadata (etag+size) del bucket. Uso: guardia CI para detectar si alguien tocó los .docx sin regenerar el contrato.
   - `/tree`: descarga los .docx y extrae texto con mammoth. Uso: regeneración manual del contrato JSON.
   - Requiere `x-service-key === SUPABASE_SERVICE_ROLE_KEY`. Nunca invocado desde `procesar-cancelacion`, `scan-document`, ni el frontend.

2. **`src/shared/prosaBancos/__contract__/referencia_davivienda.contract.json`** (líneas 10, 17) — solo cita las rutas en `sources` como procedencia documental (path/etag/size/capturedAt=2026-07-05). El contrato usado en runtime son los `prosaAsserts` (markers requeridos/prohibidos), no los .docx.

Cero coincidencias adicionales en:
- `davivienda.ts` (comparecenciaNatural/Juridica/antefirma/nota) — prosa hardcodeada, no lee ejemplos.
- Prompts de Gemini (`procesar-cancelacion`, `scan-document/core/poderBanco`, `process-expediente`) — sin few-shot, sin `download` de esos paths.
- `descubrir-reglas` — opera sobre `data_ia` vs `data_final` de trámites cerrados, no sobre los .docx del bucket.
- Sin embeddings/RAG/fine-tuning en el repo.

## Diagnóstico

Los archivos son **material de referencia legal congelado** ("golden samples" provistos por Alejandra/legal el 2026-07-05, según `capturedAt` del contrato). Sirvieron para:
1. Diseñar a mano la prosa canónica en `davivienda.ts` (snapshot literal según el header del propio archivo).
2. Extraer los `prosaAsserts` del contrato JSON (markers "COMPARECIÓ:", "APODERADA GENERAL", etc.) que los tests de paridad validan contra el render.

Después quedaron en el bucket como fuente auditable, con `audit-refs-davivienda` como puente opcional para regenerar el contrato si legal actualiza los ejemplos. **No hay ningún camino de código en runtime que los descargue o los inyecte al prompt.**

## Recomendación (no accionar todavía)

Son seguros de:
- **Mantener**: cuestan ~124 KB, son evidencia forense de la fuente jurídica original.
- **Mover a un bucket `_reference/` con nombre explícito** si molesta que compartan carpeta con las plantillas operativas (`formato cancelacion hipoteca blanqueado v2.docx`). Requeriría actualizar 2 constantes en `audit-refs-davivienda/index.ts` + regenerar el contrato con las nuevas rutas.
- **Borrar**: rompería `/tree` (regeneración manual del contrato) pero no rompe producción. Solo si legal confirma que los ejemplos ya no son fuente autoritativa.

¿Quieres que prepare un plan de reubicación o de borrado, o cierro aquí con la conclusión de auditoría?
