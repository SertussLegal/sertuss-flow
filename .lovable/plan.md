
# Blindaje anti-transposición cédula apoderado — extensión skill al 3er GAP

Extiende el patrón `menciones_X` (skill `blindaje-anti-transposicion-ocr`, ya vivo en `menciones_rl`, `menciones_direccion`, `menciones_matricula`) al **apoderado destinatario del poder**, cuya cédula hoy no tiene comparador de menciones — solo Reglas 2.2/2.3/3/4 (formato, longitud, NO_LEGIBLE, placeholder).

---

## 0. Cuestiones resueltas con evidencia

### Q1 — ¿Colisión con `representantes[]` o con `apoderado.cedula`?

Evidencia (`poderBancoExtractor/tool.ts`):

- `apoderado.tipo` ∈ {`natural`, `juridica`}.
- `natural`: campos escalares `apoderado.nombre`, `apoderado.cedula` (+ legacy plano `apoderado_cedula`).
- `juridica`: `apoderado.representantes[]` con `{nombre, cedula, cargo, es_firmante}` — cada item es un firmante independiente de la sociedad apoderada (RL principal + suplentes, ej. Lina + Kleitman).

**No hay colisión** con `menciones_rl` (que vive en `poderdante`, otra rama). El nombre nuevo será `apoderado.menciones_cedula[]`. Es un array de **evidencia forense cruda**, hermano de los escalares y de `representantes[]`, no un reemplazo de ninguno. Sigue el contrato del skill §2 (`menciones_X`), §6 (deep-merge preserva menciones).

### Q2 — Múltiples apoderados / suplentes (crítico)

**Sí existen simultáneamente** cuando `apoderado.tipo='juridica'` (caso real Lina Magaly + Kleitman como Primer Suplente). Un array plano `[{seccion, cedula, pagina}]` produciría **falsos positivos**: la cédula de Lina y la de Kleitman son legítimamente distintas y el comparador dispararía `menciones_incoherentes` siempre que haya suplente.

**Solución (idéntica al espejo `menciones_rl`, que ya lleva `nombre` en cada item)**: cada mención transcribe **también el nombre** que aparece pegado a esa cédula en el PDF. El comparador agrupa por **nombre normalizado** (uppercase + colapso de espacios + strip de tildes/coletillas de cargo) y aplica la regla de coherencia **dentro de cada grupo**. Grupos distintos no se comparan entre sí. Menciones con nombre no legible o vacío se descartan del set (mismo criterio `NULLY_MENCION` §3 del skill).

Esto también funciona sin ceremonia para `tipo='natural'` (un solo grupo con un solo nombre).

### Q3 — ¿Alejandra reportó confusión sobre "cuál apoderado firma"?

**No tengo evidencia en el codebase** de un reporte suyo específicamente sobre atribución cédula↔persona cuando hay suplente. Lo declaro honestamente. El diseño con `nombre` por mención **de todos modos** cubre ese caso lateral (si una mención atribuye la cédula de Kleitman al nombre de Lina, quedaría dentro del grupo "LINA" con dos cédulas distintas → dispara). Es un beneficio derivado, no la motivación.

### Q4 — ¿`confField` sigue siendo necesario después de este blindaje?

Coincide con el diagnóstico anterior: **no en cancelaciones**. El único caso residual sería "una sola mención + tinta ilegible", ya cubierto por `NO_LEGIBLE` + Regla 3 hard-block (`isNoLegible()`). `menciones_cedula` cierra el 3er GAP prioritario. Los GAPs 2 (escritura/fecha del poder) siguen abiertos pero son de menor prioridad — hoy tienen Regla 2.1/2.1b plano-vs-profundo, que atrapa la mitad del problema; se pueden atender en un turno posterior con este mismo patrón.

---

## 1. Schema — `poderBancoExtractor/tool.ts`

Dentro de `apoderado` (después de `sociedad_reformas`, antes de `representantes`):

```ts
menciones_cedula: {
  type: "array",
  description:
    "TRAZABILIDAD ANTI-ALUCINACIÓN. Registra cada aparición INDEPENDIENTE de la cédula de un apoderado firmante dentro del MISMO PDF (cuerpo del poder, firma manuscrita, notas de identificación al pie, anexos). Cuando hay varios apoderados/suplentes (tipo='juridica' con representantes[]), transcribe el NOMBRE tal como aparece pegado a cada cédula para que el validador determinista agrupe por persona antes de comparar. NO inventes menciones; solo las que efectivamente leas. Si solo hay una mención legible, emite 1 sola entrada.",
  items: {
    type: "object",
    properties: {
      seccion: {
        type: "string",
        enum: ["cuerpo_poder", "firma", "identificacion_al_pie", "anexo", "otro"],
      },
      nombre: { type: "string", description: "Nombre tal como aparece en ESTA sección, MAYÚSCULAS. Sirve al backend para agrupar menciones del mismo firmante." },
      cedula: { type: "string", description: "Cédula tal como aparece en esta sección. Solo dígitos. Si es ilegible, 'NO_LEGIBLE'." },
      pagina: { type: "number" },
    },
    required: ["seccion"],
    additionalProperties: false,
  },
},
```

**No** tocar `required` del objeto raíz. **No** tocar `representantes[]` ni escalares.

---

## 2. Prompt — `poderBancoExtractor/prompt.ts`

Nuevo bloque "BLINDAJE ANTI-TRANSPOSICIÓN — APODERADO" pegado al bloque equivalente del RL:

```
Antes de emitir apoderado.cedula (natural) o cada apoderado.representantes[].cedula
(juridica), transcribe ADEMÁS en apoderado.menciones_cedula[] cada aparición
literal de una cédula de firmante en el MISMO PDF (cuerpo, firma manuscrita,
identificación al pie, anexos). En cada entrada incluye el NOMBRE que aparece
pegado a esa cédula tal como está escrito. NO reformatees, NO deduzcas, NO
inventes. Si solo hay una mención legible, emite una. Si la cédula está
borrosa/tachada, escribe 'NO_LEGIBLE'.

Objetivo: permitir al backend detectar transposiciones de dígitos y atribuciones
cruzadas cuando hay varios firmantes (ej. representante + suplente).
```

---

## 3. Regla de coherencia — `poderBancoExtractor/validate.ts`

Nuevo bloque **Regla 6**, gemelo estructural de Regla 5 (líneas 285-317). Vive en el mismo archivo por afinidad temática y para reutilizar `normalizeCedula`, `isNoLegible`, `isCedulaValida`, `NULLY_MENCION`, y la excepción Manual>OCR (`opts.manualReviewConfirmed`).

Pseudocódigo:

```ts
// Regla 6 — Coherencia intra-documento de la cédula del apoderado.
// Agrupa por nombre normalizado (no mezcla cédulas de firmantes distintos).
const mAp = (apoderado?.menciones_cedula ?? []) as Array<Record<string, unknown>>;
if (Array.isArray(mAp) && mAp.length >= 2) {
  const groups = new Map<string, Set<string>>();
  for (const m of mAp) {
    const nom = normalizeNombreFirmante(String(m?.nombre ?? ""));
    if (!nom || NULLY_MENCION.has(nom)) continue;
    const raw = m?.cedula as string | undefined;
    if (isNoLegible(raw)) continue;
    const ced = normalizeCedula(raw);
    if (!ced) continue;
    if (!groups.has(nom)) groups.set(nom, new Set());
    groups.get(nom)!.add(ced);
  }
  const inconsistente = Array.from(groups.values()).some((s) => s.size >= 2);
  if (inconsistente) {
    // Excepción Manual>OCR: se suprime cuando manualReviewConfirmed
    // Y la cédula escalar del apoderado natural o de TODOS los representantes
    // afectados quedó válida (isCedulaValida). menciones_cedula se preserva.
    const humanArbitrated = opts?.manualReviewConfirmed === true &&
      apoderadoCedulasEscalaresValidas(apoderado, apoderadoCedulaPlano);
    if (!humanArbitrated) {
      warnings.push("apoderado_cedula_menciones_incoherentes");
      suspicious.add("apoderado.menciones_cedula");
      suspicious.add("apoderado.cedula");
      suspicious.add("apoderado_cedula"); // legacy plano
      // Si tipo='juridica', marcar también los items de representantes[] cuya
      // cédula colisiona con alguna mención inconsistente (best-effort).
    }
  }
}
```

`normalizeNombreFirmante`: uppercase + strip tildes + colapso de espacios + strip de coletillas de cargo (`", SUPLENTE"`, `"(PRIMER SUPLENTE)"`). Nunca fuzzy match (§7 skill).

**Sufijo `_menciones_incoherentes`** → engancha automáticamente `HARD_BLOCK_WARNING_SUFFIXES` (validate.ts:73-84). Cero migración de constantes.

**Labels** (validate.ts:88-155):

- `WARNING_LABELS["apoderado_cedula_menciones_incoherentes"]` = "Cédula del apoderado inconsistente entre menciones del poder"
- `SUSPICIOUS_FIELD_LABELS["apoderado.menciones_cedula"]` = "Menciones de la cédula del apoderado"
- `SUSPICIOUS_FIELD_LABELS["apoderado.cedula"]`, `["apoderado_cedula"]` (ya existente o similar — confirmar al implementar).

---

## 4. Wiring — sin cambios estructurales

- `procesar-cancelacion/index.ts` ya llama a `validatePoderBancoCoherencia` dentro de `annotatePoderCoherencia`. La nueva Regla 6 sale automáticamente en el mismo warnings/suspicious. No hay nuevo `annotate*` que agregar.
- `detectRequiereRevisionManual` ya filtra por `isHardBlockCoherenciaWarning` → hard-block automático.
- `mergeRegenPayload` ya deep-mergea `apoderado` key-by-key (verificar al implementar; si no lo hace, agregar `apoderado` a la lista, mismo patrón `poderdante` §6 skill).
- UI `PoderBannersV5` / suspicious highlighting ya renderiza cualquier código en `WARNING_LABELS` / `SUSPICIOUS_FIELD_LABELS`.

---

## 5. Tests — `src/shared/poderBancoValidateMencionesApoderado.test.ts` (nuevo)

Siguiendo la matriz canónica del skill:

1. **Caso ancla — 1 apoderado natural, 3 menciones consistentes** → no dispara.
2. **1 apoderado natural, 2 menciones con transposición** (`79392406` vs `79382406`) → dispara `apoderado_cedula_menciones_incoherentes` + suspicious `apoderado.menciones_cedula` + `apoderado.cedula`.
3. **1 sola mención legible** → no dispara (§3.1 skill).
4. **NO_LEGIBLE parcial + resto consistente** → no dispara.
5. **2 apoderados (juridica: Lina + Kleitman suplente)**, cada uno con menciones consistentes internamente pero cédulas distintas entre sí → **no dispara** (validación crítica del agrupamiento por nombre).
6. **2 apoderados, transposición dentro del grupo de Kleitman** → dispara, y suspicious marca menciones + escalar. Grupo de Lina intacto.
7. **Formato distinto sin cambio de dígitos** (`52.123.456` vs `52123456`) → no dispara (normalización determinista §4 skill, sin colapsar dígitos).
8. **Payload legacy sin `menciones_cedula`** → no dispara (guard `Array.isArray && length >= 2`).
9. **Excepción Manual>OCR**: `manualReviewConfirmed=true` + escalar `apoderado.cedula` corregido a cédula válida → suprime warning; `menciones_cedula` se preserva íntegro.
10. **Contrato hard-block**: `isHardBlockCoherenciaWarning("apoderado_cedula_menciones_incoherentes") === true`.

Todos los tests existentes (`poderBancoValidateMencionesRL.test.ts`, `poderBancoValidate.test.ts`, `poderBancoValidateIntraTramite.test.ts`, `certificadoInmuebleValidate.test.ts`, `mergeRegenPayload.test.ts`) deben seguir verdes sin tocarlos.

---

## 6. Archivos afectados

1. `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` — schema (`apoderado.menciones_cedula`).
2. `supabase/functions/_shared/isomorphic/poderBancoExtractor/prompt.ts` — bloque BLINDAJE APODERADO.
3. `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts` — Regla 6 + `normalizeNombreFirmante` + labels.
4. `supabase/functions/_shared/isomorphic/mergeRegenPayload.ts` — solo si `apoderado` no está aún en deep-merge key-by-key (verificar; si ya está, no tocar). Test correspondiente si se toca.
5. **Nuevo**: `src/shared/poderBancoValidateMencionesApoderado.test.ts`.

### Explícitamente fuera de alcance

- GAPs 2 (`menciones_escritura_poder`, `menciones_fecha_poder`): siguiente turno.
- Fase 4ª compraventa: sigue pausada (§8 skill).
- UI de edición de `menciones_cedula`: se preservan como evidencia forense; el humano edita el escalar canónico (§5 skill).

---

## 7. Riesgos y anti-ejemplos que este diseño evita

- ❌ Array plano sin `nombre` → falso positivo cuando hay suplente. **Resuelto** con agrupamiento por nombre.
- ❌ Fuzzy match sobre nombres → prohibido §7 skill. Se usa normalización determinista estricta.
- ❌ Pedir al modelo que "verifique si las cédulas coinciden" → el modelo alucinó una vez. La regla es código.
- ❌ Borrar menciones al confirmar humano → §5/§7 skill. Se preservan siempre.
- ❌ Migrar `HARD_BLOCK_WARNING_SUFFIXES` → sufijo estándar `_menciones_incoherentes` engancha solo.

