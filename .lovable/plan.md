# Diagnóstico — Cancelación `c8924aa2` (SOLO INVESTIGACIÓN)

## Bug 1 — Bloque profundo v6 desaparece entre `data_ia` y `data_final`

### Causa raíz (línea exacta)

`src/pages/CancelacionValidar.tsx` **L347–357**, dentro del `useEffect` de hidratación inicial:

```ts
const ia_pb: PoderBanco = (ia.poder_banco ?? {}) as PoderBanco;
const src_pb: PoderBanco = (source.poder_banco ?? {}) as PoderBanco;
const poderBanco: PoderBanco = {
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

Esto reconstruye `poder_banco` **enumerando explícitamente 9 claves planas** — sin `...ia_pb`/`...src_pb`. Todos los bloques profundos v6 (`apoderado.sociedad_*`, `apoderado.representantes`, `poderdante`, `instrumento_poder`, `facultades`, `vigencia`, `has_apoderado_banco_v3`, `motivos_incompletitud`) que sí trajo la IA quedan **fuera del state `data`** apenas se abre la pantalla.

### Punto exacto donde se persiste el daño

1. Ese `data` recortado alimenta el snapshot del form.
2. `persistData` (L438–447) hace `UPDATE cancelaciones SET data_final = data` — persiste el objeto ya sin bloque profundo.
3. Ese mismo `data` se envía como `manualOverrides` a `procesar-cancelacion` (L462–464 regen; L536 regen manual; L607 `confirm_manual_review`).

### En el backend NO hay Read-then-Merge protector

`supabase/functions/procesar-cancelacion/index.ts` **L2578–2596** (modo `regen`):

```ts
const data: CancelacionData = (manualOverrides ?? cancRow.data_final ?? cancRow.data_ia) as CancelacionData;
...
await supabaseService.from("cancelaciones").update({
  data_final: data, ...
}).eq("id", cancelacionId);
```

Se guarda **tal cual** el payload del frontend (comentario en el código: *"SSOT: frontend payload manda"*). No hay merge contra `cancRow.data_final` anterior ni contra `data_ia`. Lo mismo aplica a `confirm_manual_review` (L2209): `const data = (cancRow.data_final ?? cancRow.data_ia)` — usa lo que ya está en BD, que YA fue mutilado por el primer autosave.

Cadena completa de pérdida:

```text
data_ia (Gemini v6 completo)
  └─ hydrate useEffect L342                     ← usa data_final si existe, si no data_ia
       └─ pick manual de 9 keys (L347)          ← ★ AQUÍ SE PIERDE EL BLOQUE PROFUNDO
            └─ setData(hydrated)
                 └─ autosave debounce → UPDATE data_final = data (L442)
                      └─ regen manualOverrides = data (L464)
                           └─ edge L2593 UPDATE data_final = data (idempotente, ya sin bloque)
```

### Patrón "Read-then-Merge" en el proyecto

Existe como memoria core (`mem://index.md`: *"Datos: 'Read-then-Merge' y 'Hidratación Atómica'"*) y se aplica en `mergePoderBancoV6`, `mergePoderBancoFlat` (supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts) y en el flujo `reprocess_poder` de la edge (L2391 `prevDataFinal = cancRow.data_final`). **El hueco** es exactamente el path de edición manual: hidratación del form + regen. Ese path NUNCA re-mergea el bloque profundo original.

Consecuencia real observada en `c8924aa2`: `data_ia.poder_banco` tiene apoderado jurídica CONECTIVA GLOBAL SAS con representantes Lina/Kleitman + poderdante Davivienda + instrumento_poder Notaría 29 Silvia Palacios. `data_final.poder_banco` solo tiene `apoderado_nombre="LINA CAMPOS"` como si fuera apoderada directa del banco → la escritura sale **omitiendo la cadena de representación**.

---

## Bug 2 — Alcance de strings `"null"` / `"undefined"` literales

### Evidencia de datos reales

Barrido con `jsonb_path_query` sobre TODA la tabla `cancelaciones` buscando cualquier string exactamente igual a `"null"`, `"undefined"` o `"NaN"` en cualquier profundidad del `data_final`:

```text
0443d2f1  → 1 hit
2fb6ba16  → 1 hit
c8924aa2  → 1 hit
32f5317e  → 2 hits
15582708  → 1 hit
9a78aebb  → 1 hit
```

**7 ocurrencias en 6 filas**. En 5 de las 6 el único hit es `hipoteca_anterior.valor_hipoteca_original = "null"`. En `32f5317e` hay 2 hits en el mismo camino (histórico de poder_banco monolítico ya blindado por `stripNullyStrings`, ver test `sanitizeNullPattern.test.ts` línea "regresión 32f5317e"). **Ningún hit** en `partes.*`, `inmueble.*`, `notaria_emisora.*`, `analisis_legal.*`, ni en subcampos de `poder_banco` distintos a los ya cubiertos.

### Superficie schema-wise que podría recibir `"null"` de la IA

Los extractores IA que sueltan strings a `data_ia` son:
- `procesar-cancelacion` (monolítico Gemini 2.5 Pro) → escribe `hipoteca_anterior.*`, `partes.*`, `inmueble.*`, `poder_banco.*`.
- `poderBancoExtractor` v6 dedicado → ya blindado (`sanitizeString` + `stripNullyStrings` + `NULLY_STRINGS` set).
- Prompts de `procesar-cancelacion/index.ts` — auditados (test `sanitizeNullPattern.test.ts` "prohíben 'null si es ilegible'"): ya dicen `OMITE el campo si es ilegible` en 8+ puntos.

El único vector activo restante es la salida monolítica hacia `hipoteca_anterior` — específicamente `valor_hipoteca_original` cuando Gemini no encuentra la cuantía y devuelve el string `"null"` en vez de omitir.

### Sanitizador genérico recursivo vs lista fija

| Aspecto | Recursivo genérico | Lista fija |
|---|---|---|
| Cobertura futura | Cubre campos que aún no existen | Requiere update por cada campo nuevo |
| Riesgo over-sanitization | Alto en campos donde `"null"` sea literal legítimo (poco probable en notarial) | Nulo |
| Riesgo en objetos con semántica | Tocaría dentro de `apoderado`, `poderdante`, `instrumento_poder` — donde `null` como marca de "campo omitido" ya tiene significado (schema v6 explícito) | Nulo |
| Coste implementación | Un walker + tests | 3 líneas por campo |
| Punto de aplicación óptimo | Justo antes de persistir `data_ia` / `data_final` en la edge, después de `stripNullyStrings` | Igual |

**Recomendación (a validar en el plan de fix):** extender `stripNullyStrings` a operar sobre un mapa de rutas conocidas (`hipoteca_anterior.valor_hipoteca_original`, `hipoteca_anterior.cuantia_origen`, etc.) — MISMA función, MISMO set `NULLY_STRINGS`, pero con lista explícita de paths. Evita walker recursivo (que arriesgaría reventar la semántica `null` intencional del schema profundo v6). Aplicarlo en el sitio único donde la edge escribe `data_ia`/`data_final` en el modo normal (no en regen, para no re-sanear datos ya escritos).

Alternativa complementaria: reforzar el prompt del monolítico con la misma instrucción `OMITE el campo` para `valor_hipoteca_original` (los 6 casos con hit sugieren que Gemini responde con `"null"` string cuando no puede leer la cuantía).

---

## Resumen ejecutivo

| Bug | Causa raíz | Archivo:línea |
|---|---|---|
| Bloque profundo se pierde | Hidratación reconstruye `poder_banco` enumerando 9 claves planas, sin spread del objeto original | `src/pages/CancelacionValidar.tsx:347-357` |
| Backend no protege | Modo `regen` guarda `data_final = manualOverrides` sin merge contra el `data_ia` original | `supabase/functions/procesar-cancelacion/index.ts:2578-2593` |
| Alcance null literal | Confinado a `hipoteca_anterior.valor_hipoteca_original` (5 de 6 casos) + histórico blindado en `32f5317e` | 6 cancelaciones, 7 ocurrencias totales |

Sin cambios de código en este turno — plan estrictamente diagnóstico.
