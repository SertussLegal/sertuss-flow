# Plan — Limpieza y actualización de skills (5 acciones)

Solo toca skills bajo `.agents/skills/` y `mem://index.md` + un nuevo `mem://` file. Cero cambios de código de la app. Todos los skills activos viven en `.workspace/skills/` (read-only) y se editan como drafts en `.agents/skills/` + `skills--apply_draft`.

---

## 1) Eliminar `convertir-numero-a-letras`

**Verificación de referencias hecha** (`grep -rn` en `.workspace/skills/`):

- `direccion-completa-saneada-cancelacion/SKILL.md` — NO lo referencia.
- `limpieza-segura-codigo/SKILL.md:24` — lo menciona como ejemplo en el "Principio de Preservación Notarial" (`sanitizar-direccion`, `convertir-numero-a-letras`, etc.). Referencia **ilustrativa**, no funcional.
- El propio archivo tiene un stub de 1 línea que redirige a `formato-texto-numero-notarial`.
- Memoria (`mem://index.md`) no lo lista.

**Acción:**
- Borrar `.workspace/skills/convertir-numero-a-letras/` vía Settings > Skills (no se puede rm directo — reset por mensaje).
- Editar `.agents/skills/limpieza-segura-codigo/SKILL.md` (crear draft desde `.workspace/`) para reemplazar el ejemplo por `formato-texto-numero-notarial` y `direccion-completa-saneada-cancelacion`, evitando que quede colgando un nombre inexistente.

---

## 2) Consolidar `sanitizar-direccion` → `direccion-completa-saneada-cancelacion`

**Comparación de contenido (ambos leídos completos):**

| Bloque | `sanitizar-direccion` | `direccion-completa-saneada-cancelacion` | ¿Único de sanitizar? |
|---|---|---|---|
| Trigger `buildDocxVars` | ✅ | ✅ (Fase A) | no |
| Regex catastral con `\(?…\)?` | ✅ | ✅ idéntica | no |
| Regex `Y\/?O` + `DIRECCI[OÓ]N` | ✅ | ✅ idéntica | no |
| Colapso espacios + MAYÚSCULAS | ✅ | ✅ | no |
| Función `execute({nomenclatura_predio, ciudad})` | ✅ (contrato viejo, 1-fase, sin `esBogota`) | ❌ — el nuevo usa Fase A pura + Fase B con `esBogota`/departamento | **sí (obsoleto)** |
| Tabla de tests | ✅ 5 filas | ✅ 6 filas (incluye Bogotá + Villeta) | no |
| Anti-ejemplos regex | ✅ 4 | ✅ 6 (incluye GUION vs `-`) | no |
| Regla GUION → `-` | ❌ | ✅ | — |
| Regla municipio ≠ Bogotá | ❌ | ✅ | — |

**Conclusión:** `sanitizar-direccion` es un subconjunto estricto del actual (que ya lo declara así en su description: "Incluye el sub-paso de limpieza regex de la nomenclatura urbana (antes `sanitizar-direccion`)"). No hay información única a rescatar salvo el nombre del contrato viejo `execute({nomenclatura_predio, ciudad})`, que ya está superado por el pipeline de 2 fases.

**Acción:**
- Nombre canónico que se queda: **`direccion-completa-saneada-cancelacion`** (más completo, más reciente, ya incluye la nota "antes `sanitizar-direccion`").
- Añadir al final una sección `## Historial` de 2 líneas: "Este skill absorbió a `sanitizar-direccion` (2026-07). El contrato viejo `execute({nomenclatura_predio, ciudad})` está superado por el pipeline Fase A + Fase B descrito arriba."
- Borrar `.workspace/skills/sanitizar-direccion/` vía Settings > Skills.
- Editar `limpieza-segura-codigo` (mismo draft del paso 1) para retirar la referencia a `sanitizar-direccion`.

---

## 3) Actualizar `validar-poder-general-banco`

**Estado actual:** un solo bloque `execute()` con regex de facultades. **No menciona** NO_LEGIBLE, hard-block de generación, badges de revisión manual, ni `stripNullyStrings`.

**Acción:** reescribir como skill de referencia (no solo de trigger), agregando estas secciones con rutas a los archivos reales:

- **Sección "Validación de facultades" (lo actual, se conserva).**
- **Sección "Hard-block NO_LEGIBLE en generación"** — describe el flujo: `detectRequiereRevisionManual` + `ManualReviewRequiredError` en `supabase/functions/procesar-cancelacion/index.ts`; disparado desde `action: "regen"` y `action: "confirm_manual_review"`. Tests: `procesar-cancelacion/index_manualReview_test.ts` (7 casos, 6 paths críticos + coherencia_warnings). Efecto en UI: `PoderBannersV5.tsx` / badges de revisión manual.
- **Sección "Regla 5 — coherencia intra-documento RL"** — `menciones_rl` en `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts`. Tests: `src/shared/poderBancoValidateMencionesRL.test.ts`.
- **Sección "`stripNullyStrings` — cinturón anti-`"null"` literal"** — `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts` (FLAT_STRING_KEYS + NULLY_STRINGS exportados). Tests: `src/shared/sanitizeNullPattern.test.ts`. Justificación: incidente real filas `32f5317e` / `0443d2f1`.
- **Anti-ejemplos:** no reintroducir el bloque `apoderadoValido: false` como si fuera bloqueante — hoy la señal fuerte es `_coherencia_warnings` + `NO_LEGIBLE`, no la regex de facultades.

---

## 4) Actualizar `verificar-consistencia-notarial`

**Estado actual:** solo cruce escritura↔certificado por número. **No menciona** poder↔acreedor.

**Acción:** agregar sección **"Coherencia intra-trámite: poder ↔ acreedor real"**:

- Fuente: `supabase/functions/_shared/isomorphic/poderBancoExtractor/validateIntraTramite.ts` (`validatePoderVsCancelacion`).
- Regla 1 (primaria): NIT poderdante vs NIT acreedor (normalización solo dígitos). Si ambos NITs están, cualquier ruido textual del nombre se ignora.
- Regla 2 (respaldo, solo si falta al menos un NIT): fuzzy de nombres bancarios normalizados (portado defensivamente desde `bankDirectory.ts` porque no es importable desde edges).
- Warnings emitidos: `poder_entidad_nit_incoherente` (HARD_BLOCK), `poder_entidad_nombre_incoherente` (HARD_BLOCK).
- Tests: `src/shared/poderBancoValidateIntraTramite.test.ts`.
- Anti-ejemplo: no aplicar la regla 2 cuando ambos NITs están presentes (produce falsos positivos por variaciones legales del nombre).

---

## 5) Nueva memoria: `mem://tech/blindaje-poder-bancario`

**Tipo:** `reference` — decisión arquitectónica, no procedimiento paso a paso.

**Contenido propuesto (borrador para tu revisión antes de aplicarlo):**

- **Problema original (2026-07):**
  - Render en blanco del PDF del poder (worker WASM del pdf.js roto en producción).
  - Alucinación de `apoderado_cedula` "41525143" cuando la imagen era ilegible.
  - Literal `"null"` colándose en `data_ia`/`data_final` (filas `32f5317e`, `0443d2f1`).

- **5 capas de defensa construidas (en orden de ejecución):**
  1. **wasmUrl → PNG binarizado** (`src/lib/pdfToImages.ts`): worker robusto + fallback binarización para OCR limpio antes de Gemini.
  2. **Hard-block `NO_LEGIBLE`** (`procesar-cancelacion/index.ts` + `index_manualReview_test.ts`): 6 paths críticos + `_coherencia_warnings` con sufijo hard-block ⇒ `ManualReviewRequiredError` antes de tocar `storage.upload`.
  3. **Regla 5 — coherencia intra-documento RL** (`_shared/isomorphic/poderBancoExtractor/validate.ts` + `menciones_rl`): valida que el RL mencionado calce con el firmante del poder.
  4. **Coherencia intra-trámite** (`_shared/isomorphic/poderBancoExtractor/validateIntraTramite.ts`): poderdante del poder = acreedor real del certificado/escritura antecedente (NIT primario, nombre fuzzy solo si falta NIT).
  5. **`stripNullyStrings` + `NULLY_STRINGS` exportados** (`_shared/isomorphic/poderBancoExtractor/merge.ts`): cinturón final que borra literales `"null"/"undefined"/"N/A"/…` de los 8 campos planos legacy antes de `buildDocxVars`.

- **Referencias:**
  - Skills `validar-poder-general-banco` y `verificar-consistencia-notarial` (actualizados en esta misma sesión).
  - Tests en `src/shared/poderBanco*.test.ts` y `procesar-cancelacion/index_manualReview_test.ts`.

- **Actualizar `mem://index.md`:** añadir bajo "Memories":
  `- [Blindaje Poder Bancario](mem://tech/blindaje-poder-bancario) — 5 capas: wasmUrl/PNG, NO_LEGIBLE hard-block, Regla 5, intra-trámite, stripNullyStrings`

---

## Orden de ejecución en build mode

1. Escribir los drafts en `.agents/skills/` (paralelo):
   - `direccion-completa-saneada-cancelacion/SKILL.md` (+ nota histórica)
   - `validar-poder-general-banco/SKILL.md` (reescrito)
   - `verificar-consistencia-notarial/SKILL.md` (nueva sección)
   - `limpieza-segura-codigo/SKILL.md` (retirar refs muertas)
2. `skills--apply_draft` para cada uno (paralelo).
3. Escribir `mem://tech/blindaje-poder-bancario` + actualizar `mem://index.md` (paralelo).
4. Reportar al usuario que `convertir-numero-a-letras` y `sanitizar-direccion` deben eliminarse manualmente desde **Settings > Skills** (los skills activos no son borrables desde tool — solo desactivables por el usuario).

## Riesgos / decisiones abiertas

- **No puedo borrar skills activos** desde tool: paso 1 y 2 dejan el skill obsoleto vacío hasta que el usuario los elimine desde Settings > Skills. Alternativa: reducir el body del obsoleto a un stub tipo "DEPRECADO — usar X" (igual que hoy hace `convertir-numero-a-letras`). ¿Prefieres que dejemos el stub o esperamos a que los borres tú?
- El paso 3 cambia la naturaleza del skill (de "trigger con execute" a "referencia con múltiples secciones"). ¿OK cambiar el estilo, o prefieres mantenerlo como skill de trigger y crear otro separado tipo `blindaje-poder-runtime`?
