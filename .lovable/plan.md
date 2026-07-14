# Fase A — Fix definitivo A1 + A2 (SOLO PLAN)

## A1 — Preservar bloque profundo v6 en hidratación + defensa backend

### Diff 1 · `src/pages/CancelacionValidar.tsx` L75-93 (ampliar tipo)

Se añaden los campos profundos v6 como opcionales al tipo `PoderBanco` para que el spread los conserve sin `as any`. Firmas de índice para no forzar cada subcampo.

```ts
type PoderBanco = {
  apoderado_nombre?: string;
  apoderado_cedula?: string;
  apoderado_escritura?: string;
  apoderado_fecha?: string;
  apoderado_fecha_dia?: string;
  apoderado_fecha_mes?: string;
  apoderado_fecha_anio?: string;
  apoderado_notaria_poder?: string;
  apoderado_genero?: "M" | "F" | "";
  has_apoderado_banco?: boolean | null;
  has_apoderado_banco_v3?: boolean | null;
  vigencia?: {
    tipo?: "indefinida" | "hasta_fecha" | "hasta_terminacion_contrato" | null;
    fecha_limite?: string | null;
  };
  // ── Bloque profundo v6 (opaco para la UI, sólo se preserva). ──
  apoderado?: Record<string, unknown> | null;
  poderdante?: Record<string, unknown> | null;
  instrumento_poder?: Record<string, unknown> | null;
  facultades?: Record<string, unknown> | null;
  motivos_incompletitud?: unknown;
  _classifier_motivos?: unknown;
  // Escape hatch para futuros campos profundos sin regresar aquí.
  [k: string]: unknown;
};
```

### Diff 2 · `src/pages/CancelacionValidar.tsx` L348-360 (hidratación por spread)

Antes:
```ts
const ia_pb: PoderBanco = (ia.poder_banco ?? {}) as PoderBanco;
const src_pb: PoderBanco = (source.poder_banco ?? {}) as PoderBanco;
const poderBanco: PoderBanco = {
  apoderado_nombre:        src_pb.apoderado_nombre        ?? ia_pb.apoderado_nombre,
  apoderado_cedula:        src_pb.apoderado_cedula        ?? ia_pb.apoderado_cedula,
  // ... 7 líneas más ...
  apoderado_genero:        src_pb.apoderado_genero        ?? ia_pb.apoderado_genero,
};
```

Después:
```ts
const ia_pb: PoderBanco = (ia.poder_banco ?? {}) as PoderBanco;
const src_pb: PoderBanco = (source.poder_banco ?? {}) as PoderBanco;
// Read-then-Merge: parte de todo lo que trajo la IA (incluyendo bloques
// profundos v6: apoderado.sociedad_*, representantes, poderdante,
// instrumento_poder, facultades, vigencia, has_apoderado_banco_v3,
// motivos_incompletitud) y encima aplica la edición manual sólo en las
// 9 claves planas editables (src_pb ?? ia_pb).
const poderBanco: PoderBanco = {
  ...ia_pb,
  ...src_pb,
  apoderado_nombre:        src_pb.apoderado_nombre        ?? ia_pb.apoderado_nombre,
  apoderado_cedula:        src_pb.apoderado_cedula        ?? ia_pb.apoderado_cedula,
  apoderado_escritura:     src_pb.apoderado_escritura     ?? ia_pb.apoderado_escritura,
  apoderado_fecha:         src_pb.apoderado_fecha         ?? ia_pb.apoderado_fecha,
  apoderado_fecha_dia:     src_pb.apoderado_fecha_dia     ?? ia_pb.apoderado_fecha_dia,
  apoderado_fecha_mes:     src_pb.apoderado_fecha_mes     ?? ia_pb.apoderado_fecha_mes,
  apoderado_fecha_anio:    src_pb.apoderado_fecha_anio    ?? ia_pb.apoderado_fecha_anio,
  apoderado_notaria_poder: src_pb.apoderado_notaria_poder ?? ia_pb.apoderado_notaria_poder,
  apoderado_genero:        src_pb.apoderado_genero        ?? ia_pb.apoderado_genero,
};
```

Notas:
- `{...ia_pb, ...src_pb}` primero deja intacto lo profundo (src_pb pisa a ia_pb sólo donde src_pb definió algo — importante porque el usuario nunca edita el bloque profundo en la UI, así que src_pb no lo pisará).
- Las 9 sobreescrituras finales replican EXACTAMENTE la lógica `src ?? ia` previa para las claves planas (no cambia comportamiento visible).
- Riesgo: si `src_pb` alguna vez trae explícitamente `apoderado: null` (borrado intencional), pisaría al ia_pb. Hoy no ocurre — la UI no toca el bloque profundo. Aceptable.

### Diff 3 · `supabase/functions/procesar-cancelacion/index.ts` L2578-2597 (defensa backend `regen`)

Antes:
```ts
if (regen) {
  const data: CancelacionData = (manualOverrides ?? cancRow.data_final ?? cancRow.data_ia) as CancelacionData;
  ...
  await supabaseService.from("cancelaciones").update({
    data_final: data,
    ...
  }).eq("id", cancelacionId);
```

Después:
```ts
if (regen) {
  // Read-then-Merge defensivo: manualOverrides puede sobreescribir campos
  // conocidos por el frontend, pero NUNCA debe borrar bloques profundos
  // v6 (apoderado.sociedad_*, poderdante, instrumento_poder, ...) que el
  // frontend no envía porque no los edita.
  const base: CancelacionData = (cancRow.data_final ?? cancRow.data_ia ?? {}) as CancelacionData;
  const overrides = (manualOverrides ?? {}) as Partial<CancelacionData>;
  const mergedPB = {
    ...((base as any).poder_banco ?? {}),
    ...((cancRow.data_ia as any)?.poder_banco ?? {}),  // rescatar profundo v6 si data_final lo perdió
    ...((base as any).poder_banco ?? {}),               // pero mantener ediciones planas de data_final
    ...((overrides as any).poder_banco ?? {}),          // aplicar edición actual del frontend
  };
  const data: CancelacionData = {
    ...base,
    ...overrides,
    poder_banco: mergedPB,
  } as CancelacionData;
  if (!data) { /* 400 igual */ }
```

Simplificación equivalente y más legible (misma semántica, sin doble spread de base):
```ts
const iaPB    = (cancRow.data_ia    as any)?.poder_banco ?? {};
const basePB  = (base               as any)?.poder_banco ?? {};
const ovPB    = (overrides          as any)?.poder_banco ?? {};
const mergedPB = { ...iaPB, ...basePB, ...ovPB };
const data: CancelacionData = { ...base, ...overrides, poder_banco: mergedPB } as CancelacionData;
```

Claves:
- `ovPB` va último → frontend puede sobreescribir cualquier plano.
- Ausencia de una clave en `ovPB` **NO borra** — sólo `undefined` en el spread lo dejaría pasar; el frontend nunca envía `apoderado: undefined` explícito porque el tipo no lo declara.
- Se rescata `iaPB` para el caso patológico de una fila con `data_final` ya mutilado histórico (como c8924aa2). Con esto, un simple regen recupera el bloque profundo perdido de la IA original.
- El resto del payload (`hipoteca_anterior`, `partes`, `inmueble`, `analisis_legal`, `notaria_emisora`) sigue con `...base, ...overrides` — el frontend SÍ es fuente de verdad para esos bloques (los edita completos), así que la semántica actual se preserva.

### Test A1a (frontend, nuevo) · `src/pages/CancelacionValidar.hydration.test.tsx`

Test unitario del merge (extraer la lógica a una función pura `hydratePoderBanco(ia_pb, src_pb)` en el mismo archivo o helper para hacerla testeable directa, sin renderizar la página).

Casos:
1. **Ancla c8924aa2**: `ia_pb` con bloque profundo v6 completo (apoderado jurídica CONECTIVA + poderdante + instrumento_poder), `src_pb` sólo con planos editados → resultado debe contener `apoderado.sociedad_razon_social`, `poderdante`, `instrumento_poder`, y planos con valores de `src_pb`.
2. **Persona natural directa**: `ia_pb.apoderado.tipo="natural"`, sin `sociedad_*` ni `representantes` → resultado no debe inventar campos, sólo preserva lo que existía.
3. **Superconjunto**: para toda clave `k` en `ia_pb` no editada por `src_pb`, `resultado[k] === ia_pb[k]`.
4. **Sobreescritura plana**: `src_pb.apoderado_nombre = "X"` gana sobre `ia_pb.apoderado_nombre = "Y"`.

### Test A1b (backend, nuevo) · `supabase/functions/procesar-cancelacion/regen_merge_test.ts`

Test unitario de la fusión `regen` extraída a helper puro `mergeRegenPayload({ dataIa, dataFinal, overrides })`. Casos:
1. **Rescate profundo**: `dataIa.poder_banco` con `apoderado.sociedad_razon_social`, `dataFinal.poder_banco` sólo con planos, `overrides` sólo cambia `apoderado_nombre` → resultado conserva `sociedad_razon_social`.
2. **No borrado**: overrides sin la clave `apoderado` (bloque profundo) → resultado sigue teniendo el apoderado profundo.
3. **Sobreescritura permitida**: overrides con `poder_banco.apoderado_nombre` gana.

## A2 — Sanear `hipoteca_anterior.valor_hipoteca_original`

### Diff 4 · `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts`

Ampliar `stripNullyStrings` a operar sobre un **mapa opcional de rutas planas** en cualquier objeto raíz. Firma nueva backwards-compat:

```ts
/**
 * Limpia strings tóxicos ("null"/"undefined"/"N/A"/…) en un conjunto acotado
 * de rutas planas conocidas. Devuelve copia superficial + copia superficial
 * de cada objeto tocado (no muta input, no walker recursivo).
 *
 * Uso legacy (sin `paths`) → conserva comportamiento actual sobre
 * FLAT_STRING_KEYS del propio poder_banco.
 */
export function stripNullyStrings<T extends Record<string, unknown> | undefined | null>(
  obj: T,
  paths?: ReadonlyArray<readonly [string, string]>,   // [subObjetoKey, campoKey]
): T {
  if (!obj || typeof obj !== "object") return obj;

  // Modo legacy: limpia FLAT_STRING_KEYS directamente sobre `obj`.
  if (!paths) {
    const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
    for (const key of FLAT_STRING_KEYS) {
      const raw = out[key];
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed || NULLY_STRINGS.has(trimmed)) delete out[key];
    }
    return out as T;
  }

  // Modo por rutas: limpia obj[sub][field] para cada (sub, field).
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const [sub, field] of paths) {
    const child = out[sub];
    if (!child || typeof child !== "object") continue;
    const raw = (child as Record<string, unknown>)[field];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || NULLY_STRINGS.has(trimmed)) {
      out[sub] = { ...(child as Record<string, unknown>) };
      delete (out[sub] as Record<string, unknown>)[field];
    }
  }
  return out as T;
}

/** Rutas fuera de poder_banco que también pueden recibir "null" de la IA. */
export const CANCELACION_NULLY_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["hipoteca_anterior", "valor_hipoteca_original"],
  ["hipoteca_anterior", "cuantia_origen"],  // metadata: si viene "null" queda vacía
];
```

### Diff 5 · `supabase/functions/procesar-cancelacion/index.ts` (call site)

Localizar el punto donde se persiste `data_ia` tras el OCR monolítico (modo normal, NO regen — el modo regen no debe re-sanear porque data_final ya vive). Aplicar antes del insert/update:

```ts
import { stripNullyStrings, CANCELACION_NULLY_PATHS } from "../_shared/isomorphic/poderBancoExtractor/merge.ts";
// ... existente que ya limpia poder_banco:
data.poder_banco = stripNullyStrings(data.poder_banco);
// nuevo, mismo módulo, misma función, otras rutas:
const cleaned = stripNullyStrings(data, CANCELACION_NULLY_PATHS);
// persistir `cleaned` como data_ia (o merge con data).
```

Ubicación exacta a confirmar durante el build: mismo bloque donde hoy se hace la primera escritura de `data_ia` / `data_final` en el flujo normal (no regen, no reprocess). Se ubica leyendo `rg -n "stripNullyStrings" supabase/functions/procesar-cancelacion/index.ts` y aplicando junto al call existente. Un solo call site nuevo.

### Test A2 (nuevo) · `src/shared/sanitizeNullPattern.test.ts` (extender)

Casos:
1. `data.hipoteca_anterior.valor_hipoteca_original = "null"` → tras `stripNullyStrings(data, CANCELACION_NULLY_PATHS)` la clave se elimina.
2. Valores legítimos (`"$50.000.000 M/CTE"`) intactos.
3. `hipoteca_anterior` ausente → no crashea.
4. Modo legacy sin `paths`: comportamiento actual sobre `poder_banco` no cambia (regresión c8924aa2 y 32f5317e siguen pasando).

## Impacto y riesgo

| Cambio | Superficie | Riesgo |
|---|---|---|
| Spread `{...ia_pb, ...src_pb}` en frontend | Sólo hidratación inicial de cancelaciones | Bajo — src_pb sigue ganando en las 9 planas |
| Ampliar `PoderBanco` type con index signature | Sólo tipo, no runtime | Nulo |
| Merge `regen` en backend | Sólo modo regen (autosave + regen manual) | Bajo — nunca borra, sólo agrega el rescate desde `data_ia` |
| `stripNullyStrings` con paths opt-in | Modo legacy intacto | Nulo — firma backwards-compat |
| Nuevo call site en flujo normal | Un solo lugar tras OCR monolítico | Bajo — sólo elimina strings tóxicas |

Sin cambios en RLS, sin migraciones, sin edge functions nuevas, sin tocar el docx template.

## No incluido en Fase A (queda para B/C)

- Regenerar los 6 docx históricos que ya se emitieron sin la cadena de representación (requiere pass administrativo, no fix de código).
- Prompt del monolítico para que Gemini nunca emita `"null"` como string en `valor_hipoteca_original` (defensa complementaria, no necesaria si el sanitizador cubre).
- Mostrar la cadena de representación en la UI de `PoderViewerTab` (hoy solo se preserva en `data_final`; su render en el docx depende de la plantilla y de `prosa_apoderado_override`).
