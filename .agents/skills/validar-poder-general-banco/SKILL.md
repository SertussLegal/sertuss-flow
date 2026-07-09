---
name: validar-poder-general-banco
description: Skill de referencia para el blindaje del poder general bancario en cancelaciones — validación de facultades notariales, hard-block NO_LEGIBLE en generación de docx, Regla 5 de coherencia intra-documento del RL, y cinturón `stripNullyStrings` contra literales `"null"`. Úsalo cuando toques cualquier paso del pipeline `poder_banco` (OCR → merge → validate → docx).
type: reference
---

# Validación del Poder General del Banco — Blindaje Multi-Capa

Este skill deja de ser solo un trigger regex de facultades. Es la referencia unificada del blindaje construido en 2026-07 tras el incidente de render en blanco + alucinación de cédula en cancelaciones Davivienda.

Ver también memoria de decisión arquitectónica: `mem://tech/blindaje-poder-bancario`.

---

## 1) Validación de facultades notariales (capa semántica clásica)

Trigger: `after_ocr_extraction`. Auditor semántico rápido sobre el texto OCR del poder para detectar si menciona facultad explícita de cancelar hipotecas / liberar gravámenes. Es **una señal blanda** — nunca bloquea generación por sí sola.

Expresiones notariales colombianas relevantes:

```ts
const expresionesFacultad = [
  /cancelar\s+(?:total\s+o\s+parcialmente\s+)?hipotecas/i,
  /liberar\s+(?:de\s+)?grav[aá]menes/i,
  /otorgar\s+(?:y\s+firmar\s+)?escrituras\s+de\s+cancelaci[oó]n/i,
  /cancelaci[oó]n\s+de\s+hipoteca/i,
  /extinguir\s+obligaciones\s+hipotecarias/i,
];
```

Si ninguna matchea → emitir alerta preventiva en UI, **no** bloquear. La señal fuerte hoy vive en las capas 2–4.

---

## 2) Hard-block `NO_LEGIBLE` en generación de docx

**Fuente:** `supabase/functions/procesar-cancelacion/index.ts` — funciones `detectRequiereRevisionManual` y `generateAndUploadCancelacionDocs`, clase `ManualReviewRequiredError`.

**Flujo:** antes de tocar `storage.upload` para el docx, se revisan 6 paths críticos + `_coherencia_warnings`. Si cualquiera trae `"NO_LEGIBLE"` (trim + case-insensitive) o un warning con sufijo hard-block, se lanza `ManualReviewRequiredError` con `paths` y `motivos` poblados.

Paths críticos cubiertos:

- `poder_banco.apoderado_cedula`
- `poder_banco.apoderado_escritura`
- `poder_banco.apoderado_fecha`
- `poder_banco.apoderado.cedula`
- `poder_banco.instrumento_poder.escritura_num`
- `poder_banco.instrumento_poder.fecha`

**Consumidores del error:**

- `action: "regen"` → responde HTTP 409 con `{ ok: false, error: "manual_review_required", paths, motivos }`.
- `action: "confirm_manual_review"` → responde `biz("manual_review_not_resolved", ...)` con `pendientes` concatenados.

**Tests:** `supabase/functions/procesar-cancelacion/index_manualReview_test.ts` (7 casos: caso limpio + 6 paths críticos + combinación con warning + contract-level de ambos catches).

**Efecto en UI:** los badges de revisión manual en `src/components/cancelaciones/PoderBannersV5.tsx` (bajo el flag `POWER_V5_ENABLED`) reflejan estos paths/motivos hasta que un humano los corrija en el formulario.

---

## 3) Regla 5 — coherencia intra-documento del RL del banco

**Fuente:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts` — función `validatePoderBancoCoherencia`, sub-regla que consume `poderdante.menciones_rl`.

**Qué hace:** cuando el OCR extrae ≥2 menciones del representante legal del banco (cuerpo del poder, firma, certificado superfinanciera…), compara sus cédulas normalizadas. Si hay al menos dos cédulas legibles y distintas, emite:

- Warning: `rl_banco_menciones_incoherentes` (sufijo `_menciones_incoherentes` ⇒ HARD_BLOCK).
- Suspicious paths: `poderdante.menciones_rl`, `poderdante.representante_legal_cedula`.

**Caso real cubierto:** cédula `79392406` en cuerpo del poder vs `79382406` en certificado de la Superfinanciera (transposición dígito 2↔9).

**Normalización:** puntos, espacios y `NO_LEGIBLE` parcial se ignoran de forma determinista; una sola mención o payload legacy sin `menciones_rl` **no** dispara la regla.

**Tests:** `src/shared/poderBancoValidateMencionesRL.test.ts` (7 casos: real, 3 consistentes, 1 sola mención, legacy, normalización, `NO_LEGIBLE` parcial, contrato HARD_BLOCK).

---

## 4) `stripNullyStrings` — cinturón anti-`"null"` literal

**Fuente:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts` — exporta `NULLY_STRINGS` (Set) y `stripNullyStrings<T>(pb: T): T`.

**Qué borra:** literales tóxicos `"null"`, `"undefined"`, `"NULL"`, `"None"`, `"N/A"`, `"n/a"`, `"-"`, `""` (post-trim) de los campos planos legacy del `poder_banco` antes de que lleguen a `buildDocxVars`. Solo actúa sobre string keys planas — nunca sobre objetos anidados con semántica.

**Justificación:** incidente real en filas `32f5317e-76a9-45c6-8365-e5ff6e8e9572` y `0443d2f1-2206-4e44-bc46-6c0af2bbf7ee`, donde `apoderado_nombre="null"` (string) llegó al docx renderizándose literalmente como la palabra "null". Migración de limpieza histórica ya corrió; `stripNullyStrings` previene regresión futura.

**Interacción con Fase 2:** corre **antes** del hard-block NO_LEGIBLE, así que un `"null"` residual del OCR queda como `undefined` (⇒ nullgetter pinta `___________`) sin activar falsamente el hard-block.

**Tests:** `src/shared/sanitizeNullPattern.test.ts`.

---

## Anti-ejemplos

- ❌ Reintroducir `apoderadoValido: false` de la capa 1 como bloqueante duro — la validación de facultades es informativa; la señal fuerte vive en `_coherencia_warnings` + `NO_LEGIBLE`.
- ❌ Convertir `"null"` a string vacío `""` en vez de a `undefined` — rompe el nullgetter determinista de docxtemplater que pinta `___________` para campos ausentes.
- ❌ Aplicar `stripNullyStrings` a objetos anidados (`instrumento_poder`, `menciones_rl`) — solo campos planos. Los anidados los valida la capa 2 o la Regla 5.
- ❌ Bypassar `detectRequiereRevisionManual` desde el frontend "porque el usuario ya vio los badges" — el hard-block es defensa en profundidad del servidor; el humano corrige en el formulario y **luego** el server re-valida.
- ❌ Confiar en una sola cédula OCR sin mirar `menciones_rl` cuando hay múltiples fuentes en el mismo PDF (cuerpo + firma + Superfinanciera).
