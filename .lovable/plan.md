# Diagnóstico — `apoderadoClassifier.ts` (cliente vs edge)

> Esta "plan card" es un **informe de solo lectura**. No propone ejecución. La consolidación se decidirá en una sesión posterior tras tu confirmación explícita.

## 1. Resumen ejecutivo

La lógica de negocio de ambos archivos es **byte-idéntica**. Las 15 líneas de diferencia (151 vs 166) son:
- **+`MOTIVO_LABELS`** (12 líneas) solo en cliente — textos human-readable para UI.
- **+comentarios/JSDoc extendido** en edge (header Plan v7 Enmienda 1, numeración 2a/2b/2c/2d, referencia a `system_events`).

No hay divergencia funcional observable en producción hoy. El riesgo real es **drift futuro**: no existe guardrail que impida romper la simetría.

## 2. Diff funcional

| Elemento | Cliente | Edge | Coincide |
|---|---|---|---|
| Tipos (`TipoApoderado`, `ApoderadoPayload`, `ClassifierResult`) | ✔︎ | ✔︎ | ✅ |
| `CORPORATE_PATTERNS` (10 regex) | ✔︎ | ✔︎ | ✅ |
| `hasCorporateContamination`, `isNonEmpty` | ✔︎ | ✔︎ | ✅ |
| `classifyApoderado` (override → confianza → tipo → Regla A + C → Regla B) | ✔︎ | ✔︎ | ✅ |
| Códigos de motivos estables | ✔︎ | ✔︎ | ✅ |
| `MOTIVO_LABELS` (export UI) | ✔︎ | — | ⚠︎ solo cliente |
| Header + comentarios detallados | mínimo | extenso | ⚠︎ solo edge |

**Casos borde:** ambos manejan igual nombres con "S.A.S./Ltda./Representante Legal", jurídicas sin NIT / sin razón social / sin constitución, naturales sin escritura de poder completa, `_confianza_tipo === "baja"`, y `null/undefined`. Ninguno normaliza acentos, ni maneja poderes múltiples, ni sanitiza más allá de `String(...)`.

## 3. Impacto en producción HOY

Ejemplo hipotético: apoderado `"ANA MARIA MONTOYA"` con cargo `"Representante Legal de CONECTIVA S.A.S."`
- **Cliente** (`PoderBannersV5.tsx`): degrada a `null`, muestra banner con `MOTIVO_LABELS["corporate_keywords_in_natural_classification"]`.
- **Edge** (`procesar-cancelacion/index.ts:999`): degrada a `null`, emite mismo código de motivo.

**Resultado idéntico.** Cualquier input que entre a las ramas donde "difieren" cae en las mismas condiciones porque no hay diferencia lógica.

**"Más reciente":** por el header ("Plan v7 Enmienda 1", "Mantener sync") la edge parece la fuente original y el cliente su espejo posterior. Sin metadatos de commit accesibles no se puede fechar con certeza.

## 4. Call-sites (radio de impacto)

**Cliente — `src/lib/apoderadoClassifier.ts`:**
- `src/components/cancelaciones/PoderBannersV5.tsx` L25-29, L59, L122 → `classifyApoderado`, `MOTIVO_LABELS`, tipos.
- `src/lib/apoderadoClassifier.test.ts` → 13 tests Vitest.

**Edge — `supabase/functions/_shared/apoderadoClassifier.ts`:**
- `supabase/functions/procesar-cancelacion/index.ts` L19, L992, L999 → `classifyApoderado`, `ApoderadoPayload`.
- Sin suite de tests dedicada del lado Deno.

**Total:** 2 call-sites productivos (1 por lado) + 1 suite de tests solo cliente.

## 5. Recomendación técnica (no ejecutar aún)

Consolidar hacia `src/shared/apoderadoClassifier.ts` replicando el patrón ya validado con `src/shared/prosaBancos/`:

1. Mover lógica + tipos + `CORPORATE_PATTERNS` + `MOTIVO_LABELS` + comentarios del edge a `src/shared/apoderadoClassifier.ts` (TS puro, sin `Deno`, sin React, sin `Database`).
2. Convertir `src/lib/apoderadoClassifier.ts` en re-export (`export * from "@/shared/apoderadoClassifier"`) para preservar el import path actual.
3. Convertir `supabase/functions/_shared/apoderadoClassifier.ts` en shim de re-export tipo `prosaBancos/index.ts`.
4. Mover tests a `src/shared/apoderadoClassifier.test.ts`.
5. Añadir `apoderadoClassifier` al `purity.test.ts` existente + crear `parity.test.ts` mínimo (input → `ClassifierResult` idéntico en ambos lados).

**Ganancias:** un solo lugar para reglas jurídicas, guardrails automáticos, eliminación de drift latente.

**Riesgos / trade-offs:** hay que verificar que el bundler Deno del edge acepte el path shared (ya probado con `prosaBancos`, riesgo bajo); preservar los comentarios extendidos del edge para no perder trazabilidad legal Plan v7.

**Fuente de verdad propuesta:** la unión — lógica idéntica de cualquiera + `MOTIVO_LABELS` del cliente + header/comentarios del edge.

## 6. Restricción confirmada

Este documento **no** modifica, mueve ni elimina archivos. Espera tu confirmación explícita para pasar a una sesión de ejecución.
