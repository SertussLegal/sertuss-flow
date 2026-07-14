# Fase A — Fix definitivo A1 + A2

> **Nota:** este plan ya fue aprobado e implementado en el turno anterior. Todos los archivos y tests están en el árbol y los 34 tests pasan. Se re-emite sin cambios para tu revisión final; aprobarlo de nuevo es no-op (o sirve para revalidar). Si algo debe cambiar, dime qué y ajusto.

## A1 — Preservar bloque profundo v6 en hidratación + defensa backend

### Diff 1 · `src/pages/CancelacionValidar.tsx` — tipo `PoderBanco` ampliado + helper puro

Se añaden los bloques profundos v6 como opcionales (sin index signature para no romper la compatibilidad con `Json` de supabase) y se extrae `hydratePoderBanco` como función pura testeable.

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
  vigencia?: { tipo?: "indefinida" | "hasta_fecha" | "hasta_terminacion_contrato" | null; fecha_limite?: string | null };
  // Bloque profundo v6: opaco para la UI, sólo se preserva atómicamente.
  apoderado?: Record<string, unknown> | null;
  poderdante?: Record<string, unknown> | null;
  instrumento_poder?: Record<string, unknown> | null;
  facultades?: Record<string, unknown> | null;
  motivos_incompletitud?: unknown;
  _classifier_motivos?: unknown;
};

export function hydratePoderBanco(ia_pb: PoderBanco, src_pb: PoderBanco): PoderBanco {
  return {
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
}
```

El call site en el `useEffect` de hidratación (L382) queda:

```ts
const ia_pb: PoderBanco = (ia.poder_banco ?? {}) as PoderBanco;
const src_pb: PoderBanco = (source.poder_banco ?? {}) as PoderBanco;
const poderBanco: PoderBanco = hydratePoderBanco(ia_pb, src_pb);
```

Además, `data_final: data` en el `.update(...)` (L473) requiere cast `as unknown as Json` porque `PoderBanco` con campos `Record<string, unknown>` deja de ser `Json`-asignable estructural. Se añade `import type { Json } from "@/integrations/supabase/types"`.

### Diff 2 · Helper puro `supabase/functions/_shared/isomorphic/mergeRegenPayload.ts` (nuevo)

```ts
export function mergeRegenPayload<T extends Record<string, unknown>>(args: {
  dataIa: T | null | undefined;
  dataFinal: T | null | undefined;
  overrides: Partial<T> | null | undefined;
}): T {
  const dataIa = (args.dataIa ?? {}) as Record<string, unknown>;
  const base = (args.dataFinal ?? args.dataIa ?? {}) as Record<string, unknown>;
  const overrides = (args.overrides ?? {}) as Record<string, unknown>;
  const iaPB   = (dataIa.poder_banco    ?? {}) as Record<string, unknown>;
  const basePB = (base.poder_banco      ?? {}) as Record<string, unknown>;
  const ovPB   = (overrides.poder_banco ?? {}) as Record<string, unknown>;
  const mergedPB = { ...iaPB, ...basePB, ...ovPB };
  return { ...base, ...overrides, poder_banco: mergedPB } as unknown as T;
}
```

Reglas garantizadas:
- `overrides` gana en las claves que envía.
- Ausencia de una clave en `overrides` NUNCA borra — cae en `data_final` o `data_ia`.
- `poder_banco` se fusiona por-clave `iaPB → basePB → ovPB` (rescate del profundo aunque `data_final` esté mutilado).

### Diff 3 · `supabase/functions/procesar-cancelacion/index.ts` modo `regen` (L2578-2586)

```ts
if (regen) {
  const data = mergeRegenPayload<Record<string, unknown>>({
    dataIa: cancRow.data_ia as Record<string, unknown> | null,
    dataFinal: cancRow.data_final as Record<string, unknown> | null,
    overrides: (manualOverrides ?? null) as Record<string, unknown> | null,
  }) as unknown as CancelacionData;
  if (!data || Object.keys(data as Record<string, unknown>).length === 0) {
    return new Response(JSON.stringify({ error: "No hay datos para regenerar" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // resto del flujo intacto
}
```

## A2 — Sanear `hipoteca_anterior.valor_hipoteca_original`

### Diff 4 · `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts`

`stripNullyStrings` recibe un `paths?` opcional. Modo legacy (sin `paths`) intacto para `FLAT_STRING_KEYS` de `poder_banco`. Modo con rutas hace copia superficial del subobjeto tocado, sin walker recursivo (evita reventar la semántica `null` intencional del schema profundo v6).

```ts
export function stripNullyStrings<T extends Record<string, unknown> | undefined | null>(
  pb: T,
  paths?: ReadonlyArray<readonly [string, string]>,
): T {
  if (!pb || typeof pb !== "object") return pb;
  const out: Record<string, unknown> = { ...(pb as Record<string, unknown>) };
  if (paths) {
    for (const [sub, field] of paths) {
      const child = out[sub];
      if (!child || typeof child !== "object") continue;
      const raw = (child as Record<string, unknown>)[field];
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed || NULLY_STRINGS.has(trimmed)) {
        const copy = { ...(child as Record<string, unknown>) };
        delete copy[field];
        out[sub] = copy;
      }
    }
    return out as T;
  }
  for (const key of FLAT_STRING_KEYS) {
    const raw = out[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed || NULLY_STRINGS.has(trimmed)) delete out[key];
  }
  return out as T;
}

export const CANCELACION_NULLY_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["hipoteca_anterior", "valor_hipoteca_original"],
  ["hipoteca_anterior", "cuantia_origen"],
];
```

### Diff 5 · `procesar-cancelacion/index.ts` — call site único en flujo normal (~L2942)

Justo antes de `detectRequiereRevisionManual(...)`, sanear `extracted` y usar la copia para `data_ia`, `data_final`, columnas denormalizadas de `hipoteca_anterior` y para `generateAndUploadCancelacionDocs`. Modo `regen` NO re-sanea (evita re-tocar datos ya editados por el usuario).

```ts
const cleanedExtracted = stripNullyStrings(
  extracted as unknown as Record<string, unknown>,
  CANCELACION_NULLY_PATHS,
) as unknown as typeof extracted;
const revision = detectRequiereRevisionManual(cleanedExtracted);
const commonUpdate = {
  data_ia: cleanedExtracted,
  data_final: cleanedExtracted,
  numero_escritura_hipoteca: cleanedExtracted.hipoteca_anterior.numero_escritura_hipoteca,
  fecha_escritura_hipoteca: cleanedExtracted.hipoteca_anterior.fecha_escritura_hipoteca,
  notaria_hipoteca: cleanedExtracted.hipoteca_anterior.notaria_hipoteca,
  valor_hipoteca_original: cleanedExtracted.hipoteca_anterior.valor_hipoteca_original,
  // resto usa `extracted` (paths fuera de CANCELACION_NULLY_PATHS son idénticos)
  ...
};
// docx:
const { minutaPath, certPath } = await generateAndUploadCancelacionDocs(
  supabaseService, cancelacionId, cleanedExtracted, prosaOv,
);
```

## Tests de regresión (3 archivos)

### `src/pages/CancelacionValidar.hydration.test.tsx` (nuevo, 4 casos)
1. **Ancla c8924aa2**: `ia_pb` con `apoderado` jurídica CONECTIVA + representantes + poderdante Davivienda + instrumento_poder Notaría 29 Silvia Palacios; `src_pb` con edición manual del `apoderado_nombre`. Resultado: planos editados ganan, todo el bloque profundo intacto.
2. **Persona natural directa**: sin sociedad ni representantes — no inventa campos.
3. **Superconjunto**: cada clave de `ia_pb` no editada por `src_pb` se preserva idéntica.
4. **Sobreescritura plana**: `src_pb.apoderado_nombre` gana.

### `src/shared/mergeRegenPayload.test.ts` (nuevo, 5 casos)
1. **Rescate profundo**: `data_final` sin `apoderado.sociedad_*` lo recupera de `data_ia`.
2. **No borrado**: `overrides` sin la clave profunda no elimina el bloque.
3. **Sobreescritura plana**: `overrides` > `data_final` > `data_ia`.
4. **Otros bloques** (`hipoteca_anterior`): `overrides` gana sobre `data_final`.
5. **Sin overrides**: `base = data_final ?? data_ia`.

### `src/shared/sanitizeNullPattern.test.ts` (extender, 5 casos nuevos)
1. `hipoteca_anterior.valor_hipoteca_original = "null"` → clave eliminada tras sanitizar con `CANCELACION_NULLY_PATHS`.
2. Valores legítimos (`"$50.000.000 M/CTE"`) intactos.
3. `hipoteca_anterior` ausente → no crashea.
4. Input no mutado (JSON.stringify pre/post idéntico).
5. Modo legacy sin `paths` sigue limpiando `FLAT_STRING_KEYS` de `poder_banco` (regresión c8924aa2 y 32f5317e).

## Impacto y riesgo

| Cambio | Superficie | Riesgo |
|---|---|---|
| `hydratePoderBanco` + spread | Hidratación inicial de cancelaciones | Bajo — 9 planas conservan semántica `src ?? ia` |
| Ampliar `PoderBanco` type | Sólo tipo; `data_final` cast a `Json` en un único update | Nulo runtime |
| `mergeRegenPayload` en backend | Modo `regen` (autosave silencioso + regen manual) | Bajo — nunca borra |
| `stripNullyStrings` con paths opt-in | Firma backwards-compat | Nulo |
| Call site nuevo tras OCR monolítico | Un solo lugar en flujo normal | Bajo |

Sin migraciones, sin RLS, sin edge functions nuevas, sin tocar plantillas docx, sin cambios de UI.

## Fuera de Fase A

- Regenerar docx históricos de las 6 filas afectadas (proceso administrativo, no fix de código).
- Prompt del monolítico para que Gemini omita en vez de emitir `"null"` (defensa complementaria, no necesaria si el sanitizador cubre).
- Render de la cadena de representación en `PoderViewerTab` (hoy sólo se preserva; su aparición en la escritura depende de la plantilla y de `prosa_apoderado_override`).
