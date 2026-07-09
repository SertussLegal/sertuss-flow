# Plan Final — Fase 1: Coherencia intra-documento del RL del banco (poder bancario)

## Alcance de este ciclo

**SÍ se construye ahora:**
- Extracción redundante del RL del banco: array `poderdante.menciones_rl[]` con las apariciones independientes dentro del MISMO PDF (cuerpo del poder, firma, certificado Superfinanciera).
- Regla determinista 5 en `validate.ts` que dispara `rl_banco_menciones_incoherentes` cuando ≥2 menciones tienen cédula normalizada distinta.
- El warning entra a `HARD_BLOCK_WARNING_SUFFIXES` → fuerza `revision_manual_requerida = true` en el edge (comportamiento ya cableado).
- Tests de regresión cubriendo: caso real (79392406 vs 79382406), menciones consistentes (no dispara), 1 sola mención (no dispara), variantes de formato con puntos/espacios (normaliza antes de comparar).

**NO se construye ahora (documentado como siguiente candidato):**
- **Fase 2** (segunda pasada dedicada al Certificado Superfinanciera): diseño queda en el plan, decisión post-datos reales de Fase 1. Alejandra confirmó que el certificado SIEMPRE viene dentro del mismo PDF → cuando se construya reutiliza `poderUrls` sin fuente adicional.
- **Fase 3** (backfill retroactivo): pospuesta sin ventana. **Nota crítica**: no es gratis — las cancelaciones históricas no tienen `menciones_rl[]`, así que retroactivo implica **volver a llamar a Gemini** por cada poder histórico (costo real de OCR × N), no solo re-correr una regla sobre datos ya guardados. Ventana (14/30/90 días) se decide después de medir tasa de disparo real en producción.

## Diff propuesto — Fase 1

### 1. `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts`

Agregar dentro de `poderdante.properties` (tras `representante_legal_cedula_expedida_en`):

```ts
menciones_rl: {
  type: "array",
  description:
    "TRAZABILIDAD ANTI-ALUCINACIÓN. Registra cada aparición INDEPENDIENTE del RL del banco dentro del MISMO PDF (cuerpo del poder, firma manuscrita, certificado Superfinanciera adjunto). Mínimo 1 entrada si el RL aparece; ideal 2-3. Sirve para que el validador determinista detecte transposiciones de dígitos entre menciones que deberían coincidir. NO inventes menciones; solo las que efectivamente leas en distintas secciones.",
  items: {
    type: "object",
    properties: {
      seccion: {
        type: "string",
        enum: ["cuerpo_poder", "firma", "certificado_superfinanciera", "otro"],
        description: "Sección del PDF donde aparece esta mención.",
      },
      nombre: { type: "string", description: "Nombre tal como aparece en esta sección. MAYÚSCULAS." },
      cedula: { type: "string", description: "Cédula tal como aparece en esta sección. Solo dígitos. Si es ilegible, 'NO_LEGIBLE'." },
      pagina: { type: "number", description: "Página del PDF (1-indexed) donde se leyó." },
    },
    required: ["seccion"],
    additionalProperties: false,
  },
},
```

**Compatibilidad:** campo opcional, no en `required`. Cachés viejos (`ocr_raw_cache`) siguen válidos: sin `menciones_rl` → Regla 5 no dispara (comportamiento actual).

### 2. `.../poderBancoExtractor/prompt.ts`

Insertar nueva sección después del bloque "EXTRACCIÓN DE CADENA PROFUNDA":

```
═══════════════════════════════════════════════════════════════════════════════
TRAZABILIDAD DEL RL DEL BANCO (poderdante.menciones_rl[])
═══════════════════════════════════════════════════════════════════════════════

El RL del banco (quien firma el poder EN NOMBRE de la entidad) suele aparecer
2-3 veces dentro del mismo PDF:
  1. Cuerpo del poder (párrafo de comparecencia).
  2. Firma manuscrita al final del instrumento.
  3. Certificado de la Superintendencia Financiera adjunto/protocolizado.

REGLA: para CADA aparición independiente que efectivamente leas, añade una
entrada a `poderdante.menciones_rl[]` con {seccion, nombre, cedula, pagina}.

NO copies la misma cédula 3 veces desde la primera lectura — VUELVE a mirar
la sección correspondiente y transcribe lo que ves ahí, dígito por dígito.
Si dos secciones muestran cédulas distintas, reporta AMBAS tal cual — el
validador determinista del backend detectará la incoherencia y pedirá
verificación humana. NUNCA armonices menciones que difieren.

Si solo hay 1 mención legible, devuelve 1 sola entrada (no rellenes).
Si no hay ninguna mención legible, omite el array.
```

### 3. `.../poderBancoExtractor/validate.ts`

**a) Añadir a `HARD_BLOCK_WARNING_SUFFIXES`:**

```ts
export const HARD_BLOCK_WARNING_SUFFIXES = [
  "_no_legible",
  "_incoherente",
  "_placeholder",
  "_duplicidad_cruzada",
  "_menciones_incoherentes",  // ← nuevo
] as const;
```

**b) Añadir a `WARNING_LABELS`:**

```ts
rl_banco_menciones_incoherentes:
  "Las menciones del representante legal del banco dentro del mismo documento no coinciden entre sí (posible transposición de dígitos) — verifica manualmente contra el PDF original.",
```

**c) Añadir a `SUSPICIOUS_FIELD_LABELS`:**

```ts
"poderdante.menciones_rl": "Menciones del representante legal del banco",
```

**d) Regla 5 al final de `validatePoderBancoCoherencia` (antes del `return`):**

```ts
// Regla 5 — Coherencia intra-documento del RL del banco (Fase 1 anti-transposición).
// Compara las cédulas normalizadas de todas las menciones independientes del
// RL leídas en distintas secciones del MISMO PDF. Si ≥2 difieren, warning +
// suspicious. Caso real que motivó la regla: 79392406 vs 79382406.
const menciones = (poderdante?.menciones_rl ?? []) as Array<Record<string, unknown>>;
if (Array.isArray(menciones) && menciones.length >= 2) {
  const cedulasNorm = menciones
    .map((m) => normalizeCedula(m?.cedula as string | undefined))
    .filter((c) => c && !isNoLegible(c));  // NO_LEGIBLE no cuenta como discrepancia
  const distintas = new Set(cedulasNorm);
  if (distintas.size >= 2) {
    warnings.push("rl_banco_menciones_incoherentes");
    suspicious.add("poderdante.menciones_rl");
    suspicious.add("poderdante.representante_legal_cedula");
  }
}
```

Notas:
- Sin `menciones_rl` o con 1 entrada → no dispara (comportamiento seguro, no rompe cachés viejos).
- `NO_LEGIBLE` en una mención se ignora (ya lo cubre Regla 3 con otro warning).
- Comparación con `normalizeCedula` → tolera "79.382.406" vs "79382406".

### 4. Tests de regresión

**Archivo nuevo:** `src/shared/poderBancoValidateMencionesRL.test.ts` (o extender `poderBancoValidate.test.ts`).

Casos mínimos:

1. **Caso real (dispara)** — 2 menciones cuerpo_poder=79392406 y certificado_superfinanciera=79382406 → warning `rl_banco_menciones_incoherentes` + `suspicious` incluye `poderdante.menciones_rl` y `poderdante.representante_legal_cedula` + `isHardBlockCoherenciaWarning('rl_banco_menciones_incoherentes') === true`.
2. **Menciones consistentes (no dispara)** — 3 menciones con misma cédula → warnings sin `rl_banco_menciones_incoherentes`.
3. **1 sola mención (no dispara)** — array con 1 entrada → no warning.
4. **Sin `menciones_rl` (no dispara)** — payload legacy → no warning (compat cachés viejos).
5. **Normalización de formato (no dispara)** — "79.382.406" vs "79382406" vs "79 382 406" → todos iguales, no warning.
6. **NO_LEGIBLE parcial** — 1 mención "NO_LEGIBLE" + 2 menciones iguales → no dispara Regla 5 (lo cubre Regla 3).
7. **Contrato HARD_BLOCK** — verificar que `HARD_BLOCK_WARNING_SUFFIXES` contiene `_menciones_incoherentes` y que `isHardBlockCoherenciaWarning` lo reconoce.

## Fuera de alcance / no tocar

- Merge (`merge.ts`): `menciones_rl` fluye por el deep passthrough existente, no requiere lógica nueva.
- Edge `procesar-cancelacion`: ya consume `validatePoderBancoCoherencia` y ya cablea `HARD_BLOCK_WARNING_SUFFIXES` → `revision_manual_requerida`. No hay diff.
- UI: los labels nuevos se muestran automáticamente vía `WARNING_LABELS` / `SUSPICIOUS_FIELD_LABELS`. Sin cambios de componentes en este ciclo.
- Fase 2 y Fase 3: documentadas arriba, no se construyen.

## Riesgos / mitigaciones

- **Modelo puede "auto-consistir" copiando la misma cédula 3 veces sin volver a mirar** → el prompt lo prohíbe explícitamente ("NO copies la misma cédula 3 veces desde la primera lectura"). Si en producción vemos que sigue pasando, es señal para acelerar Fase 2 (segunda pasada independiente del certificado, donde el modelo no puede auto-consistir porque es otra llamada con otro contexto).
- **Falsos positivos por typos triviales** (ej. espacio de más) → `normalizeCedula` ya quita puntos, espacios y guiones antes de comparar.
- **Costo tokens del prompt extra** → marginal (~200 tokens adicionales en system prompt, sin llamadas nuevas).

## Criterio de éxito

- Poderes nuevos con menciones incoherentes → `revision_manual_requerida = true` automático + warning visible en UI antes de generar Word.
- Poderes con menciones consistentes → cero fricción nueva.
- Cachés viejos → siguen funcionando sin regresión.
