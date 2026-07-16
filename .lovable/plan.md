
# Plan — Corrección del orden notarial "Nombres Apellidos" en deudores

## Contexto y evidencia leída

**Bug ancla (Alejandra):** Cancelación `1c63c1aa-9291-4db4-815d-021ad5298857` → minuta imprime `DEUDOR(A): DIAZ GARCIA MARGARITA IBETH`. El orden notarial correcto es `MARGARITA IBETH DIAZ GARCIA`.

**Causa raíz confirmada:** El schema de Gemini en `procesar-cancelacion/index.ts` líneas 265-285 pide `deudores[].nombre` como *"idéntico al certificado"*. El certificado de tradición usa formato registral `APELLIDOS NOMBRES`. El modelo transcribe verbatim y hoy nadie reordena.

**Puntos de armado identificados (relectura del código):**

- **~L831-843** `normalizeDeudores(partes)`: hidrata array `deudores[]` desde `deudor_*` singulares legacy, y sanea cada item (`nombre = String(d.nombre).toUpperCase()`). Aquí NO se reordena, se preserva verbatim.
- **~L844** `inferGeneroFromNombre(nombre)` se invoca sobre el string completo.
- **~L923** mismo helper de género se usa para `apoderado_nombre`.
- **~L1139** en el mapper docx: `deudor_nombre: deudoresNombres || data.partes.deudor_nombre` (donde `deudoresNombres` viene precomputado del array).
- **~L3091** único punto real de ensamblaje agregado: `extracted.partes.deudor_nombre = deudoresExtraidos.map(d => d.nombre).join(" Y ")`. Este es el string plano que persiste en `data_ia`/`data_final` y que la UI y el docx consumen.
- **~L3138** `commonUpdate` persiste `deudor_nombre: extracted.partes.deudor_nombre` a la columna de la tabla `cancelaciones`.

**`inferGeneroFromNombre` (`_shared/genero.ts` L106-111):**
```ts
const n = nombre.normalize(...).toUpperCase().trim().split(/\s+/)[0];
```
→ **Confirmado bug latente:** toma la PRIMERA palabra. Con formato registral `APELLIDOS NOMBRES` la primera palabra es un apellido, por lo que hoy la inferencia de género devuelve `""` en la mayoría de casos (silencioso — se cae al fallback combinado `"el(la) señor(a)"`). Peor: si un apellido coincide con un nombre del set (ej. `ANDRES`, `MARIA`, `JOSE`, `DANIEL` son apellidos comunes en Colombia y están en `NOMBRES_M`/`NOMBRES_F`), la inferencia devuelve el género *equivocado* con confianza.

**Override manual UI (`CancelacionValidar.tsx` L1121-1157):** el humano ya puede editar `deudor_nombre` como string libre por deudor, escribe a `deudores[idx].nombre` y también refresca `deudor_nombre` plano vía `.join(" Y ")`. Este flujo NO tiene equivalente de `mergeRegenPayload` (que existe solo para poder bancario) — es edición directa sobre `data_final`, y un regen posterior lo sobreescribiría (comportamiento actual, fuera de scope de este plan).

## Diseño (respuestas a tus 3 preguntas)

### A. ¿`nombre` sigue en el schema o se quita del `required`?
**Recomendación: mantener `nombre` en el schema y en `required`, agregar `apellidos` y `nombres` como campos requeridos hermanos.** Razones:
- Retrocompat total con `data_ia`/`data_final` viejos (que solo tienen `nombre`).
- Evita "romper" el contrato con el modelo de golpe: si en una corrida function-calling llena solo `nombre` (falla parcial), el ensamblador cae al legacy sin crash.
- El costo de tener el string redundante es despreciable (el modelo ya lo lee).
- El `description` de `nombre` se ajusta a *"Nombre completo tal como aparece en el certificado (formato registral, sin reordenar)"* para dejar claro que **NO** es la fuente que va a la minuta — solo evidencia cruda. La fuente autoritativa pasa a ser `apellidos` + `nombres`.

### B. `inferGeneroFromNombre` — bug latente confirmado, arreglo incluido
Sí, hay bug latente. La corrección natural es que el género se infiera del campo `nombres` (nombres de pila aislados) en vez del string completo. **Cambio mínimo:** en los 2 call sites de la edge (`normalizeDeudores` L844 y el bloque L923 del apoderado — que también sufre del mismo problema si el apoderado se transcribiera en formato registral) y en los 4 call sites del frontend (`CancelacionValidar.tsx` L445, 454, 460, 465), pasar preferentemente `d.nombres ?? d.nombre` como input. La función `inferGeneroFromNombre` en sí no cambia (sigue tomando primera palabra), lo que la vuelve correcta cuando recibe solo nombres de pila.

**Nota:** el apoderado del banco es un caso hermano — Gemini también podría transcribirlo en formato registral desde el certificado del poder. Fuera del scope estricto de este plan (foco: deudores), pero recomendable aplicar la misma separación `apellidos_apoderado` / `nombres_apoderado` en un plan sucesor. En este plan solo tocamos deudores.

### C. ¿L3091 es el único punto de ensamblaje?
**Sí, confirmado.** Es el único lugar donde se recompone el string plano `deudor_nombre` a partir del array `deudores[]`. Los otros usos (L831 hidratación desde legacy, L1139 mapper docx que lee el string ya armado, L513 UI persist) son downstream de ese punto.

## Archivos a tocar (orden de implementación)

### 1. `supabase/functions/procesar-cancelacion/index.ts` (schema Gemini + prompt)
- Añadir a `deudores[]` en el tool schema (cerca de L265-285):
  ```
  apellidos: string, required — "Apellidos del deudor en MAYÚSCULAS, tal como aparecen en el certificado."
  nombres:   string, required — "Nombres de pila del deudor en MAYÚSCULAS, tal como aparecen en el certificado. NO incluir apellidos aquí."
  nombre:    string, required — (existente, se ajusta description) "Nombre completo verbatim tal como aparece en la anotación del certificado (formato registral)."
  ```
- Ajustar el prompt/system instruction para indicar explícitamente: *"Debes identificar y separar apellidos de nombres de pila usando el orden convencional colombiano (los apellidos suelen ir al principio en el certificado registral). Si tienes duda, deja `nombres` vacío y llena solo `nombre`."*
- Actualizar los tipos TS internos (`CancelacionData["partes"]["deudores"]`) para que `apellidos?: string; nombres?: string;` sean opcionales en el tipo (retrocompat con historicos).

### 2. `supabase/functions/procesar-cancelacion/index.ts` (ensamblador determinista)
- Crear helper puro `ensamblarNombreNotarial(d)`:
  ```ts
  function ensamblarNombreNotarial(d) {
    const nombres = (d?.nombres ?? "").toString().toUpperCase().trim();
    const apellidos = (d?.apellidos ?? "").toString().toUpperCase().trim();
    if (nombres && apellidos) return `${nombres} ${apellidos}`;
    return String(d?.nombre ?? "").toUpperCase().trim();
  }
  ```
- Modificar `normalizeDeudores` (~L820-850):
  - Preservar `apellidos`/`nombres` en el objeto saneado.
  - `nombre` saneado pasa a ser `ensamblarNombreNotarial(d)` (así el downstream ya recibe el orden correcto).
  - `inferGeneroFromNombre(d.nombres || d.nombre)` en L844 → arregla el bug latente de género.
- En el hidratador desde legacy (mismo bloque): NO hay `apellidos`/`nombres` en singulares legacy → se dejan `undefined`, el ensamblador cae al `nombre` legacy sin cambio (retrocompat).
- L3091 no cambia estructuralmente: sigue siendo `.map(d => d.nombre).join(" Y ")` porque `d.nombre` YA viene reensamblado por `normalizeDeudores`. Es la mutación más pequeña posible y mantiene el `join(" Y ")` correcto para N deudores.

### 3. `supabase/functions/_shared/genero.ts`
- Sin cambios estructurales. Documentar en el JSDoc de `inferGeneroFromNombre` que el input **debe** ser nombres de pila (no el string completo con apellidos primero). Los callers son responsables de pasar el campo correcto.

### 4. `src/pages/CancelacionValidar.tsx`
- Extender el tipo local `Deudor` (L178-190) con `apellidos?: string; nombres?: string`.
- Los 4 call sites de `inferGeneroFromNombre` (L445, 454, 460, 465) pasar `d.nombres ?? d.nombre` en vez de solo `d.nombre` / `deudor_nombre`.
- **UI de edición manual:** dejar `nombre` como campo editable (comportamiento actual). Este plan **no** agrega dos inputs separados en la UI — el humano corrige el string final si el modelo se equivocó y punto (mismo criterio que ya existe hoy). `apellidos`/`nombres` se preservan en `deudores[idx]` pero son metadata de trazabilidad, no editables aún.
  - *Fuera de scope pero opcional para un follow-up:* añadir 2 inputs separados en el bloque L1173-1232 con un helper que reensambla `nombre` on-blur. No lo incluimos ahora para minimizar superficie.
- L1121-1157 `writeDeudores`: cuando el humano edita `nombre` manualmente, invalidar `apellidos`/`nombres` (`{ ...d, nombre: patch.nombre, apellidos: undefined, nombres: undefined }`) para evitar reensamblajes fantasma la próxima vez que se ejecute el ensamblador.

### 5. Tests nuevos

**`src/shared/ensamblarNombreNotarial.test.ts`** (isomórfico, sin fetch):
1. **Caso Alejandra:** `{apellidos:"DIAZ GARCIA", nombres:"MARGARITA IBETH"}` → `"MARGARITA IBETH DIAZ GARCIA"`.
2. **Fallback legacy:** `{nombre:"DIAZ GARCIA MARGARITA IBETH"}` → `"DIAZ GARCIA MARGARITA IBETH"` (verbatim, sin crash).
3. **Uno vacío:** `{apellidos:"", nombres:"MARIA", nombre:"MARIA LOPEZ"}` → cae a `"MARIA LOPEZ"` (no `" MARIA"` con espacio huérfano).
4. **Ambos vacíos + sin `nombre`:** → `""` (no crash).
5. **Trim de whitespace:** `{apellidos:"  RUIZ  ", nombres:"  PEDRO  "}` → `"PEDRO RUIZ"`.
6. **Uppercase idempotente:** input en minúsculas se normaliza a MAYÚSCULAS.
7. **Apellido compuesto con partícula:** `{apellidos:"DE LA CRUZ", nombres:"MARIA JOSE"}` → `"MARIA JOSE DE LA CRUZ"` — confirma que el ensamblador NO parsea, solo concatena.

**Test complementario para `normalizeDeudores` (si el file de test ya existe, extenderlo; si no, dejarlo para follow-up):**
- Múltiples deudores, cada uno con `apellidos`/`nombres` propios → `.join(" Y ")` produce `"MARGARITA IBETH DIAZ GARCIA Y JUAN PEREZ LOPEZ"`.
- Género inferido a partir de `nombres="MARGARITA IBETH"` → `"F"` (hoy fallaría, devolvería `""` porque `DIAZ` no está en el set).

## Retrocompatibilidad

- **Historicos en BD (`data_ia`/`data_final` sin `apellidos`/`nombres`):** ensamblador cae a `d.nombre` legacy → salida idéntica a la actual, cero regresión. Sin migración de datos.
- **Corrida nueva donde el modelo falla y solo llena `nombre`:** mismo fallback, cero crash.
- **Regen de un trámite viejo:** el modelo hace la separación en la nueva corrida; el humano puede sobrescribir vía `nombre` si el modelo se equivoca (el `writeDeudores` invalida `apellidos`/`nombres`).
- **Docx templater / prosa:** consume `deudor_nombre` string plano, indiferente al cambio interno.

## Riesgos

1. **Modelo Gemini rechaza el nuevo schema si `apellidos`/`nombres` son `required`.** Mitigación: dejarlos `required` en el schema pero con `description` que permite string vacío en caso de duda — la tool call sigue siendo válida. Si falla en QA, degradar a opcional.
2. **Nombres extranjeros con orden distinto** (ej. asiáticos: apellido primero como sistema real). Alcance: fuera del contexto notarial colombiano dominante. El modelo puede fallar la separación → cae al fallback legacy. Aceptable.
3. **Inferencia de género con `nombres`:** ahora será más agresiva (antes casi siempre `""` porque el primer token era apellido). Nombres compuestos donde el primer nombre de pila no está en el set (ej. `KARLA ANDREA`) seguirán devolviendo `""`. Ningún nombre nuevo se agrega al set en este plan — cambio mínimo.
4. **Cascada al apoderado:** el mismo bug latente de género probablemente existe para `apoderado_nombre` L923. Este plan **no** lo toca (foco: deudores). Documentar como follow-up.
5. **UI no expone edición separada:** el humano no puede editar `nombres`/`apellidos` por separado hoy. Si el modelo se equivoca en la separación pero el `nombre` verbatim también está mal (raro), el humano solo puede corregir el string plano. Aceptable como MVP.

## Lo que NO cambia

- `_shared/genero.ts` (solo docstring).
- `merge.ts`, `validate.ts` del poder bancario.
- Schema de otras entidades (apoderado, banco, inmueble).
- UI de edición del deudor (sigue con un input `nombre` por deudor).
- Migraciones de BD.
- Edge functions distintas a `procesar-cancelacion`.

## Orden de implementación sugerido

1. Crear helper `ensamblarNombreNotarial` + tests (aislado, verde antes de tocar nada más).
2. Modificar schema Gemini + prompt.
3. Modificar `normalizeDeudores` para consumir el helper + arreglar `inferGeneroFromNombre` call.
4. Actualizar tipos y los 4 call sites en `CancelacionValidar.tsx`.
5. Añadir la invalidación defensiva de `apellidos`/`nombres` en `writeDeudores`.
6. Suite completa verde (323+ tests).

## Confirmaciones pedidas (respuesta directa)

- **¿`nombre` en `required`?** Sí, se queda; el modelo lo sigue llenando verbatim (evidencia cruda + fallback). `apellidos`+`nombres` se añaden como required hermanos.
- **`inferGeneroFromNombre` bug latente:** Confirmado. La función toma `.split(/\s+/)[0]`, y con formato registral el primer token es apellido → hoy devuelve `""` casi siempre (fallback combinado silencioso), o género INCORRECTO cuando el apellido coincide con nombre del set (`MARIA`, `JOSE`, `ANDRES`, `DANIEL`, etc.). Se arregla en el mismo cambio pasando `d.nombres ?? d.nombre` en los call sites (la función misma no cambia).
- **¿L3091 único punto de ensamblaje?** Sí, confirmado. Es el único agregador de `deudor_nombre` string plano. Todos los demás usos leen el string ya armado.
