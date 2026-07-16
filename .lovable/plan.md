# Blindaje dirección catastral + matrícula inmobiliaria — Fase 1 (intra-documento)

Caso ancla: escritura 7058, matrícula 50C-1572091. OCR emitió "13C-09" (transposición) donde el certificado real dice "KR 104 13C-05 CA 119". Este plan replica el patrón `menciones_rl` → validación determinista → hard-block, exactamente como se blindó el RL del banco.

---

## Preguntas respondidas con evidencia del código

**1. ¿El certificado siempre repite dirección/matrícula en ≥2 lugares?**
No siempre. La matrícula aparece habitualmente en el encabezado y en el pie de cada anotación (típicamente ≥3 menciones), pero un certificado corto y limpio puede traer una sola instancia legible. La dirección tiene un caso legítimo de mención única: el prompt actual (`certificadoTradicion/prompt.ts` regla especial `inmueble.direccion`, y `procesar-cancelacion/index.ts:212` en la versión monolítica) admite explícitamente el escenario "solo hay un renglón sin numerar, tómalo". Por tanto la regla debe **tolerar 1 sola mención sin disparar** — mismo criterio que Regla 5 (`poderBancoValidateMencionesRL.test.ts` caso 3).

**2. ¿Existe ya normalización reusable?**
Sí, dos utilidades vivas hay que reutilizar en el comparador — no reinventar:
- `sanitizeMatricula(...)` en `procesar-cancelacion/index.ts:1072` (referencia — sirve para normalizar `50C-1.234.567` vs `50C1234567`).
- `sanitizeNomenclaturaBase(...)` del skill `direccion-completa-saneada-cancelacion` (Fase A: strip catastral, strip ciudad, "GUION"→"-", colapso de espacios). Esto ya deja la dirección en forma canónica antes de compararla.

**3. ¿Afecta al extractor de escritura antecedente / intra-trámite?**
No. Revisado `supabase/functions/scan-document/core/escrituraAntecedente/tool.ts`: los campos son `linderos_*`, `numero_escritura`, `fecha`, `notaria`, `tipo_acto`, `comparecientes[]` — **no** hay `direccion` ni `matricula` del inmueble. La dirección/matrícula viven exclusivamente en el certificado de tradición. La coherencia es **intra-documento** dentro del certificado. No hace falta módulo intra-trámite como el que se hizo con `validateIntraTramite.ts` (banco vs acreedor).

**Bonus — dónde vive el extractor real de cancelaciones:**
`procesar-cancelacion/index.ts` **no** llama a `scan-document/certificadoTradicion/*`. Tiene su propio schema monolítico inline con `inmueble.matricula_inmobiliaria`, `nomenclatura_predio`, `descripcion_predio` (líneas 207-218). Por tanto el prompt/tool a extender es el de `procesar-cancelacion`, no el de `scan-document`. `scan-document/certificadoTradicion/tool.ts` alimenta compraventa — extensión análoga queda propuesta pero fuera del alcance de este bug (Fase 2 opcional).

---

## Parte A — Campo redundante en el schema

Extender `procesar-cancelacion/index.ts` schema `inmueble` (línea 207-218) con:

```ts
menciones_direccion: {
  type: "array",
  description: "TODAS las menciones INDEPENDIENTES de la dirección catastral tal como aparecen literalmente en el certificado, ANTES de aplicar la regla de índice más alto o de reformatear. Transcribe cada mención en su forma cruda (ej: 'CL 59 SUR 60-84', 'KR 104 13C-05 CA 119'). MÍNIMO todas las líneas numeradas del bloque 'DIRECCION DEL INMUEBLE'. Si solo hay un renglón, emite 1 sola entrada — está bien. Este campo se usa para verificación cruzada anti-transposición, NO reemplaza a nomenclatura_predio.",
  items: {
    type: "object",
    properties: {
      seccion: { type: "string", description: "Sección de origen: 'direccion_inmueble_1', 'direccion_inmueble_2', 'encabezado', 'anotacion_XXXX', etc." },
      valor: { type: "string", description: "Transcripción LITERAL de esa mención, sin reformatear." },
      pagina: { type: "number", description: "Página del PDF donde aparece (opcional)." },
    },
    required: ["seccion", "valor"],
    additionalProperties: false,
  },
},
menciones_matricula: {
  type: "array",
  description: "TODAS las menciones INDEPENDIENTES del número de matrícula inmobiliaria tal como aparecen literalmente en el certificado (encabezado, pie de cada anotación, etc.). Emite tantas entradas como veces aparezca legible. Si solo hay 1, emite 1 — está bien.",
  items: {
    type: "object",
    properties: {
      seccion: { type: "string", description: "'encabezado', 'anotacion_0205', 'pie_pagina_1', etc." },
      valor: { type: "string", description: "Matrícula LITERAL tal como se lee (ej: '50C-1572091', '50C 1572091')." },
      pagina: { type: "number", description: "Página del PDF donde aparece (opcional)." },
    },
    required: ["seccion", "valor"],
    additionalProperties: false,
  },
},
```

Estructura tomada como espejo del `menciones_rl` en `poderBancoExtractor/tool.ts` (mismo shape `{seccion, valor|cedula, pagina}`).

**Prompt** (agregar una sección análoga al BLOQUE B del prompt actual — dónde exactamente: al final del `system prompt` que arma `procesar-cancelacion` justo antes de "manejo estricto de incertidumbre", análogo al bloque "menciones_rl" del prompt de poder_banco):

```
BLINDAJE ANTI-TRANSPOSICIÓN (dirección y matrícula):

Antes de emitir inmueble.nomenclatura_predio (que resulta de aplicar el "índice más alto" + formato TEXTO (NÚMERO)), transcribe ADEMÁS en inmueble.menciones_direccion[] cada mención de dirección catastral tal como aparece LITERALMENTE en el bloque "DIRECCION DEL INMUEBLE" — sin reformatear, sin verbalizar, sin reordenar. Una entrada por renglón numerado (1), 2), 3)…).

Antes de emitir inmueble.matricula_inmobiliaria, transcribe en inmueble.menciones_matricula[] cada aparición literal del número de matrícula (encabezado del certificado, y pie de cada anotación relevante). Como mínimo el encabezado y una anotación.

Objetivo: permitir al backend detectar transposiciones de dígitos (ej: 13C-05 vs 13C-09, 1572091 vs 1572081) comparando las menciones entre sí. Emite honestamente lo que ves — si solo hay una mención, emite una. NO inventes menciones extra para llenar el arreglo.
```

---

## Parte B — Módulo de validación

Nuevo archivo isomórfico:
`supabase/functions/_shared/isomorphic/certificadoInmuebleValidate.ts`

```ts
// Coherencia intra-documento de la sección `inmueble` del certificado de
// tradición. Detecta transposiciones de dígitos en dirección catastral o
// número de matrícula, comparando menciones independientes emitidas por el
// OCR. Puramente TS, isomórfico (edge + client). Nunca lanza.

const NULLY_MENCION = new Set(["", "NO_LEGIBLE", "N/A", "NULL", "UNDEFINED"]);

/** Normalización de dirección para comparación (NO para render).
 *  Reutiliza la lógica de `sanitizeNomenclaturaBase` (Fase A del skill
 *  direccion-completa-saneada-cancelacion) pero sin el sufijo notarial:
 *  strip catastral, strip ciudad, "GUION"→"-", uppercase, colapso de
 *  espacios y de separadores no significativos. */
export function normalizeDireccionForCompare(s: string): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/\(?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*\)?/gi, "")
    .replace(/\s+DE\s+LA\s+CIUDAD\s+Y\/?O\s+MUNICIPIO\s+DE\s+.+$/i, "")
    .replace(/\s+GUION(?:ES)?\s+/gi, " - ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Matrícula normalizada: uppercase, sin espacios, sin puntos. Conserva el
 *  guion ASCII porque forma parte del código ORIP oficial (50C-1572091). */
export function normalizeMatriculaForCompare(s: string): string {
  return (s ?? "").toUpperCase().replace(/[.\s]/g, "").trim();
}

export interface InmuebleCoherenciaResult {
  warnings: string[];
  suspicious: Set<string>;
}

export function validateInmuebleCoherencia(
  inmueble: Record<string, unknown> | null | undefined,
): InmuebleCoherenciaResult {
  const warnings: string[] = [];
  const suspicious = new Set<string>();
  if (!inmueble || typeof inmueble !== "object") return { warnings, suspicious };

  // Dirección — menciones ≥2 distintas tras normalizar → warning.
  const mDir = (inmueble.menciones_direccion ?? []) as Array<Record<string, unknown>>;
  if (Array.isArray(mDir) && mDir.length >= 2) {
    const vals = mDir
      .map((m) => String(m?.valor ?? "").trim())
      .filter((v) => v && !NULLY_MENCION.has(v.toUpperCase()))
      .map(normalizeDireccionForCompare)
      .filter((v) => v);
    if (new Set(vals).size >= 2) {
      warnings.push("inmueble_direccion_menciones_incoherentes");
      suspicious.add("inmueble.menciones_direccion");
      suspicious.add("inmueble.nomenclatura_predio");
    }
  }

  // Matrícula — mismo criterio.
  const mMat = (inmueble.menciones_matricula ?? []) as Array<Record<string, unknown>>;
  if (Array.isArray(mMat) && mMat.length >= 2) {
    const vals = mMat
      .map((m) => String(m?.valor ?? "").trim())
      .filter((v) => v && !NULLY_MENCION.has(v.toUpperCase()))
      .map(normalizeMatriculaForCompare)
      .filter((v) => v);
    if (new Set(vals).size >= 2) {
      warnings.push("inmueble_matricula_menciones_incoherentes");
      suspicious.add("inmueble.menciones_matricula");
      suspicious.add("inmueble.matricula_inmobiliaria");
    }
  }

  return { warnings, suspicious };
}
```

### Wiring al hard-block

**Reutiliza HARD_BLOCK_WARNING_SUFFIXES existente sin cambios.** Los dos códigos nuevos terminan en `_incoherentes` que ya matchea el sufijo `_menciones_incoherentes` (línea 78 de `poderBancoExtractor/validate.ts`). La función `isHardBlockCoherenciaWarning` usa `endsWith`, por lo que `"inmueble_direccion_menciones_incoherentes".endsWith("_menciones_incoherentes") === true`. Cero migración de constantes.

En `procesar-cancelacion/index.ts`:

1. **Import** junto a los otros validadores (línea ~1423):
```ts
import { validateInmuebleCoherencia } from "../_shared/isomorphic/certificadoInmuebleValidate.ts";
```

2. **Nueva anotación** (análoga a `annotatePoderCoherencia`, alrededor de la línea 1427):
```ts
async function annotateInmuebleCoherencia(
  supabase: any,
  inmueble: Record<string, unknown> | undefined | null,
  ctx: { orgId: string; cancelacionId: string; userId: string; trigger: string },
): Promise<void> {
  if (!inmueble) return;
  const { warnings, suspicious } = validateInmuebleCoherencia(inmueble);
  (inmueble as Record<string, unknown>)._coherencia_warnings = warnings;
  (inmueble as Record<string, unknown>)._coherencia_suspicious = Array.from(suspicious);
  if (warnings.length === 0) return;
  try {
    await supabase.from("system_events").insert({
      organization_id: ctx.orgId,
      tramite_id: ctx.cancelacionId,
      user_id: ctx.userId,
      evento: "procesar-cancelacion.inmueble.coherencia",
      resultado: "warnings",
      categoria: "ocr_certificado",
      detalle: { trigger: ctx.trigger, warnings, suspicious: Array.from(suspicious) },
    });
  } catch (_) {}
}
```

Llamarla justo después de `annotatePoderCoherencia` en el mismo punto del pipeline (donde `extracted.poder_banco` recibe su anotación) — buscar `await annotatePoderCoherencia(` y añadir la nueva llamada acto seguido pasando `extracted.inmueble`.

3. **Extender `detectRequiereRevisionManual`** (línea 1258). Actualmente solo lee `pb._coherencia_warnings`; sumar los del inmueble:
```ts
const im = (extracted.inmueble || {}) as Record<string, unknown>;
const warningsInm = Array.isArray(im._coherencia_warnings)
  ? (im._coherencia_warnings as unknown[]).filter((w): w is string => typeof w === "string")
  : [];
const motivos = [...warnings, ...warningsInm].filter(isHardBlockCoherenciaWarning);
```

Nada más. El resto (persistencia de `revision_manual_requerida=true`, banner en UI, override manual, badges en `Cancelaciones.tsx`) ya está construido y se activa solo con que `detectRequiereRevisionManual` diga `requiere=true`.

### UI (opcional, no bloqueante para el fix)

Agregar labels en `WARNING_LABELS` de `poderBancoExtractor/validate.ts`:
```ts
inmueble_direccion_menciones_incoherentes:
  "La dirección catastral se lee distinta en ≥2 secciones del mismo certificado (posible transposición de dígitos) — verifica manualmente contra el PDF original.",
inmueble_matricula_menciones_incoherentes:
  "El número de matrícula inmobiliaria aparece distinto en ≥2 secciones del mismo certificado — verifica manualmente antes de firmar.",
```
Y en `SUSPICIOUS_FIELD_LABELS`:
```ts
"inmueble.menciones_direccion": "Menciones de dirección catastral",
"inmueble.nomenclatura_predio": "Dirección catastral (nomenclatura del predio)",
"inmueble.menciones_matricula": "Menciones de matrícula inmobiliaria",
"inmueble.matricula_inmobiliaria": "Matrícula inmobiliaria",
```

---

## Tests de regresión

Nuevo archivo `src/shared/certificadoInmuebleValidate.test.ts` (imita el shape de `poderBancoValidateMencionesRL.test.ts`):

1. **Caso ancla real 7058** — `menciones_direccion` con `"KR 104 13C-05 CA 119"` × 2 + `"KR 104 13C-09 CA 119"` × 1 → dispara `inmueble_direccion_menciones_incoherentes`, `suspicious` contiene `inmueble.menciones_direccion` y `inmueble.nomenclatura_predio`, `isHardBlockCoherenciaWarning` la reconoce como hard-block.
2. **Consistente** — 3 menciones idénticas `"KR 104 13C-05 CA 119"` → no dispara.
3. **1 sola mención** — no dispara (evidencia insuficiente).
4. **Normalización de formato dirección** — `"CL 59 SUR 60 84"` vs `"CL 59 SUR 60-84"` vs `"CL 59 SUR 60 - 84"` → no dispara (misma dirección tras normalizar).
5. **Matrícula: transposición** — `"50C-1572091"` vs `"50C-1572081"` → dispara `inmueble_matricula_menciones_incoherentes`.
6. **Matrícula: formato distinto** — `"50C-1572091"` vs `"50C 1572091"` vs `"50C1572091"` → no dispara.
7. **NO_LEGIBLE parcial** — 1 mención `"NO_LEGIBLE"` + resto consistente → no dispara (mismo criterio que Regla 5).
8. **Contrato hard-block** — `isHardBlockCoherenciaWarning("inmueble_direccion_menciones_incoherentes") === true` (verifica que reutilizamos el sufijo global sin migración).

---

## Archivos afectados (diff propuesto — no implementar aún)

1. `supabase/functions/procesar-cancelacion/index.ts`
   - Añadir `menciones_direccion` y `menciones_matricula` al schema `inmueble` (~línea 213).
   - Añadir bloque de prompt "BLINDAJE ANTI-TRANSPOSICIÓN" (dentro del system prompt del mismo archivo, junto a las reglas de nomenclatura).
   - Import `validateInmuebleCoherencia`.
   - Nueva función `annotateInmuebleCoherencia` (~línea 1454).
   - Llamada a `annotateInmuebleCoherencia(supabase, extracted.inmueble, ctx)` justo después de la existente `annotatePoderCoherencia`.
   - `detectRequiereRevisionManual`: sumar warnings del inmueble a `motivos`.

2. **Nuevo**: `supabase/functions/_shared/isomorphic/certificadoInmuebleValidate.ts` (código completo arriba).

3. `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts`
   - Agregar 2 labels en `WARNING_LABELS` y 4 en `SUSPICIOUS_FIELD_LABELS`. **No** tocar `HARD_BLOCK_WARNING_SUFFIXES` — el sufijo `_menciones_incoherentes` ya cubre los códigos nuevos.

4. **Nuevo**: `src/shared/certificadoInmuebleValidate.test.ts` con los 8 casos listados.

### Fuera de alcance (Fase 2, si se decide después)
- Extender el mismo patrón a `scan-document/certificadoTradicion/tool.ts` para el flujo de compraventa. La estructura es idéntica, pero el flujo no comparte el detector de hard-block: haría falta wiring paralelo en `process-expediente`. Se documenta pero no se toca aquí — el bug ancla es de cancelaciones.
