Refinar skills y memoria del proyecto para sostenibilidad y escalabilidad. 5 pasos secuenciales:

## Paso 1 — Aplicar borrador existente
Activar `extraccion-cuantia-semantica` desde `.agents/skills/` al workspace con `skills--apply_draft`.

## Paso 2 — Crear 3 skills nuevas
- **concordancia-genero-minutas**: contrato de tokens M/F/FALLBACK (art_deudor, tit_deudor, id_deudor, etc.) con referencias a `_shared/genero.ts` y `src/lib/genero.ts`. No duplica lógica, solo documenta contrato + anti-ejemplos.
- **formato-texto-numero-notarial**: patrón `TEXTO (NÚMERO)` notarial colombiano. Referencia a `src/lib/legalProse.ts` y `supabase/functions/process-expediente/legalProse.ts` como espejos sincronizados. Documenta `numeroConLetras`, `fechaProsa`, `escrituraProsa`, `montoProsa`.
- **componente-segmented-choice**: cuándo usar `SegmentedChoice` vs `Select`/`Radio`/`Switch`. Reglas visuales (diferenciado de botón CTA), API, accesibilidad, anti-ejemplos.

## Paso 3 — Consolidar mem://index.md
- Fusionar `[Formateo Legal]` → `[formato-texto-numero-notarial]` (skill cubre lo mismo + mantenimiento).
- Fusionar `[Concordancia género]` → `[concordancia-genero-minutas]` (skill es contrato vivo).
- Eliminar duplicados de dirección para mantener index limpio.

## Paso 4 — Verificar coherencia backend-frontend
- Comparar exports de `src/lib/legalProse.ts` vs `supabase/functions/process-expediente/legalProse.ts`.
- Confirmar que `montoProsa` en backend tiene la corrección del regex `,00\)$`.
- Alinear si hay divergencia.

## Paso 5 — Deploy y validación
- `supabase--deploy_edge_functions(["procesar-cancelacion"])`.
- Validar que no hay errores de compilación ni regressiones en el pipeline de generación docx.