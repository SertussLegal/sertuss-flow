# Plan — Selección determinista de nomenclatura catastral por índice más alto

## Contexto verificado en código real

Confirmé leyendo `supabase/functions/procesar-cancelacion/index.ts`:

- **L212, L346–373, L426**: la regla "índice más alto" vive SOLO como instrucción de prompt para Gemini. El modelo transcribe `nomenclatura_predio` ya con su propia selección aplicada. No hay verificación determinista. Antipatrón exacto que `blindaje-anti-transposicion-ocr` §7 prohíbe.
- **L215–217**: `menciones_direccion[]` existe pero mide otra cosa (ruido OCR en la MISMA dirección, comparación por igualdad tras normalizar). En el caso Alejandra las 2 direcciones son legítimamente distintas → esa regla habría (a) no disparado si el modelo omitió el array, (b) disparado por razón equivocada si lo hubiera emitido.
- **L933**: `nomenclaturaBase = data.inmueble.nomenclatura_predio ?? direccion_completa`. Único punto de lectura del valor "resuelto por el modelo".
- **L953–957**: `nomenclaturaFinal` = `nomenclaturaBase` + coletilla `(DIRECCION CATASTRAL)` (solo Bogotá) + `DE LA CIUDAD Y/O MUNICIPIO ...`.
- **L1110, L1112**: `nomenclaturaFinal` se mapea a `nomenclatura_predio` y `direccion_inmueble` (retro-compat) del docx.
- **L3089**: `direccion_inmueble` de la fila `cancelaciones` se persiste desde `extracted.inmueble.nomenclatura_predio` — el string plano que el modelo eligió. Este es el valor que la UI (`CancelacionValidar.tsx` L174) muestra en el campo editable.
- **L1521 `annotateInmuebleCoherencia`**: choke-point ideal para agregar warning ámbar nuevo; ya escribe `_coherencia_warnings` y `_coherencia_suspicious` que la UI ya sabe pintar.

## Diseño

### 1. Nuevo campo de schema `direccion_candidatas`

En `supabase/functions/procesar-cancelacion/index.ts` dentro del objeto `inmueble` del tool de Gemini (junto a `nomenclatura_predio` y `menciones_direccion`). Descripción tal como la definió el usuario: transcribir TODOS los renglones numerados, aplicar formato notarial TEXTO (NÚMERO) a cada candidato, NO decidir cuál es vigente. Se agrega un bloque nuevo al prompt (paralelo al de menciones) instruyendo emitir 1 sola entrada cuando solo hay 1 renglón, sin decidir.

Se agrega el tipo TS en la interfaz local de `data.inmueble` (`direccion_candidatas?: Array<{indice: string; valor: string}>`).

**No se toca** el campo `nomenclatura_predio` en el schema — sigue siendo la fuente `fallback` y punto de compatibilidad con datos históricos y con el modelo cuando el nuevo array venga vacío.

### 2. Selector determinista puro — `direccionCandidatasSelect.ts`

**Ubicación**: `supabase/functions/_shared/isomorphic/direccionCandidatasSelect.ts` (isomórfico, igual patrón que `certificadoInmuebleValidate.ts`, importable desde edge y desde frontend vía alias `@shared`).

**API**:

```ts
export type DireccionCandidata = { indice: string; valor: string };

export type SelectResult = {
  seleccionada: string | undefined;      // valor del candidato ganador; undefined si array vacío/ausente
  indiceGanador: number | undefined;     // índice numérico normalizado
  divergeDelModelo: boolean;             // true si nomenclatura_predio del modelo ≠ seleccionada
  warnings: string[];                    // ['direccion_indice_corregido_por_codigo'] si diverge
  suspicious: Set<string>;               // 'inmueble.nomenclatura_predio', 'inmueble.direccion_candidatas'
};

export function parseIndice(raw: string): number | null;      // arábigo + romano I-XX
export function selectDireccionPorIndice(
  candidatas: DireccionCandidata[] | undefined,
  nomenclaturaModelo: string | undefined,
): SelectResult;
```

**Reglas**:

- `parseIndice`: acepta `"1".."99"` y romanos `I..XX` (case-insensitive, trim). Retorna `null` si no matchea → ese candidato se ignora (no crash).
- Filtra candidatas con `indice` no parseable o `valor` vacío / `NULLY_MENCION` (reusar constante del skill).
- Ordena descendente por índice, toma el primero.
- **Tie-break** (empate del mismo índice numérico, ej. dos "2)"): **última aparición en el array gana**. Justificación: el orden de emisión del modelo preserva el orden textual del documento; el renglón que aparece más abajo/después en el certificado es el más reciente en el flujo de anotaciones catastrales. Es determinista, no requiere metadata adicional, y coincide con la heurística notarial de "última anotación pertinente".
- Comparación `divergeDelModelo`: normaliza ambos (`toUpperCase`, colapso de espacios, strip de `(DIRECCION CATASTRAL)` y de la coletilla `DE LA CIUDAD Y/O MUNICIPIO ...` — reusar los mismos regex de L938/L940). NO fuzzy. Diverge si tras normalizar son distintos.
- Si `candidatas` es `undefined` / `[]` / todas inválidas → `seleccionada: undefined`, sin warnings, sin `suspicious`. Fallback silencioso.
- Si diverge: `warnings.push("direccion_indice_corregido_por_codigo")` y `suspicious` incluye `"inmueble.nomenclatura_predio"` y `"inmueble.direccion_candidatas"`.

**Sufijo del warning**: termina en `_por_codigo`, NO en `_menciones_incoherentes` — por diseño no engancha `HARD_BLOCK_WARNING_SUFFIXES`. Es informativo/ámbar, no bloqueante (el humano puede aceptar la corrección del código o revertirla; ambos comportamientos son válidos, no queremos bloquear generación).

**Label UI** (agregado a `WARNING_LABELS` en `CancelacionValidar.tsx`):
`"El certificado tiene varias direcciones numeradas. El sistema seleccionó la de índice más alto; verifica que sea la vigente."`

### 3. Wiring en `procesar-cancelacion/index.ts`

**Un solo punto de inyección real**: `annotateInmuebleCoherencia` (L1521). Ahí se llama al selector, se sobreescribe `inmueble.nomenclatura_predio` con `seleccionada` cuando exista, y se acumulan `warnings` + `suspicious` sobre los que ya calcula `validateInmuebleCoherencia`. Esto propaga automáticamente a:

- **L933** (`nomenclaturaBase`): lee `data.inmueble.nomenclatura_predio` ya corregido.
- **L1110, L1112** (`nomenclatura_predio`, `direccion_inmueble` del docx): derivan de `nomenclaturaFinal` → corregidos.
- **L3089** (`direccion_inmueble` persistido en fila `cancelaciones`): lee `extracted.inmueble.nomenclatura_predio` ya corregido.
- **UI `CancelacionValidar.tsx`**: el `Set` de `_coherencia_suspicious` ya está conectado al campo `direccion_inmueble` (edición previa del apoderado usó el mismo patrón — solo hay que confirmar que el campo `direccion_inmueble` ya recibe `suspicious`; si no, se agrega igual que se hizo con los 4 del apoderado).

Un único choke-point, cero duplicación entre callers.

### 4. Relación con `menciones_direccion[]` — RECOMENDACIÓN: coexisten, fuera de alcance

**Recomiendo NO tocar `menciones_direccion` ni `certificadoInmuebleValidate.ts` Regla 1** en este cambio. Razones:

- Miden fenómenos distintos: `direccion_candidatas` = selección entre hechos legítimamente distintos por índice; `menciones_direccion` = detección de ruido OCR sobre el MISMO hecho (transposición de dígitos en repeticiones de la misma dirección en encabezado + anotaciones + firma).
- Son ortogonales: en un certificado donde el renglón (2) aparezca además repetido con OCR ruidoso en la anotación de traslado, `direccion_candidatas` elige el (2) y `menciones_direccion` detecta el ruido dentro de ese (2). Removerla eliminaría cobertura real.
- La regla existente tiene tests verdes y una aplicación viva documentada en el skill; tocarla amplía superficie de riesgo sin beneficio.

Decisión: coexisten. `direccion_candidatas` opera antes (selección), `menciones_direccion` sigue operando después (ruido dentro de la selección). Documentar esto como comentario en el nuevo módulo y en la §8 del skill (nueva fila) — pero eso es doc, no código.

### 5. Tests — `src/shared/direccionCandidatasSelect.test.ts`

Casos:

1. **Caso Alejandra**: candidatas `[{indice:"1", valor:"CALLE 10 #91-01..."}, {indice:"2", valor:"KR 92 8 18..."}]`, modelo eligió el (1). Selector devuelve el (2), `divergeDelModelo=true`, warning disparado.
2. Numeración romana: `[{indice:"I",...},{indice:"II",...},{indice:"III",...}]` → gana III.
3. Empate mismo índice: `[{indice:"2",valor:"A"},{indice:"2",valor:"B"}]` → gana B (última aparición). Assert explícito del tie-break.
4. Array ausente / `undefined` → `seleccionada: undefined`, sin warnings.
5. Array vacío → idem.
6. 1 sola candidata, matchea con modelo → `divergeDelModelo=false`, sin warnings.
7. 1 sola candidata, difiere del modelo (caso patológico: modelo re-formateó de forma incompatible) → warning dispara.
8. Índice no parseable (`"a)"`, `"?"`) → se filtra; si eran las únicas → `seleccionada: undefined`.
9. `NULLY_MENCION` en valor (`"NO_LEGIBLE"`) → se filtra.
10. Comparación tolerante a coletilla y a `(DIRECCION CATASTRAL)`: modelo `"KR 92 8 18 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA"` vs candidata `"KR 92 8 18"` → no diverge.

Además, un test de integración liviano que arme el objeto `inmueble` y verifique que `annotateInmuebleCoherencia` sobreescribe `nomenclatura_predio` y agrega el warning al set — reutilizando fixture estilo `certificadoInmuebleValidate.test.ts`.

### 6. Riesgos

**R1 — Cancelaciones históricas sin `direccion_candidatas`**: el array no existe en `data_ia`/`data_final` viejos. **Mitigación**: guard `if (!candidatas || candidatas.length === 0) return { seleccionada: undefined, ... }`. El wiring solo sobreescribe si `seleccionada !== undefined`, así que histórico queda idéntico. Cero migración de datos.

**R2 — Modelo emite el array pero con formato roto** (índices no parseables, valores vacíos). **Mitigación**: el selector filtra y, si no queda nada válido, devuelve `undefined` → fallback al string plano del modelo. No crash, no falso positivo.

**R3 — Divergencia por diferencias cosméticas** (el modelo aplicó una coletilla de más, o un `(DIRECCION CATASTRAL)` doble). **Mitigación**: normalización agresiva en `divergeDelModelo` (strip de coletillas conocidas). Si aún así diverge, es señal legítima — que el warning ámbar dispare está bien, es informativo.

**R4 — Otros lectores de `nomenclatura_predio` / `direccion_inmueble`**: verificados en grep previo:
- Docx templater (`nomenclaturaFinal` L1110, L1112) — lee de `data.inmueble.nomenclatura_predio` a través de `nomenclaturaBase` L933 → cubierto.
- Persistencia BD `cancelaciones.direccion_inmueble` L3089 → cubierto.
- UI `CancelacionValidar.tsx` L174 → lee de la fila `cancelaciones` → cubierto.
- `certificadoInmuebleValidate.ts` Regla 1 (`menciones_direccion`) → no lee `nomenclatura_predio`, independiente.
- Tests de `certificadoInmuebleValidate` → no afectados (no usan `direccion_candidatas`).
- Prosa: no hay helper `nomenclaturaProsa` — se usa el string plano directamente. Sin impacto.

Todos los lectores consumen el string plano ya resuelto. Sobreescribir en `annotateInmuebleCoherencia` (antes de que cualquiera lo lea) cubre el 100%.

**R5 — Frontend `CancelacionValidar.tsx`**: verificar en implementación que el campo `direccion_inmueble` ya recibe `suspicious` desde el `Set` unificado. Si no lo recibe, agregarlo (patrón idéntico al bloque `apoderado` recién conectado). Esto es la única duda pendiente que el usuario mencionó — se resolverá con `rg` puntual antes de tocar y se aplicará el mismo patrón visual, sin lógica nueva.

## Archivos a tocar (orden de implementación)

1. **CREAR** `supabase/functions/_shared/isomorphic/direccionCandidatasSelect.ts` — función pura + tipos.
2. **CREAR** `src/shared/direccionCandidatasSelect.test.ts` — 10 casos + integración liviana.
3. **EDITAR** `supabase/functions/procesar-cancelacion/index.ts`:
   - Agregar `direccion_candidatas` al tool schema (junto a L215).
   - Agregar bloque en el prompt (junto a L426) instruyendo transcripción cruda por índice.
   - Extender interfaz TS de `data.inmueble`.
   - En `annotateInmuebleCoherencia` (L1521): llamar al selector, sobreescribir `inmueble.nomenclatura_predio`, acumular warnings/suspicious.
4. **EDITAR** `src/pages/CancelacionValidar.tsx`:
   - Verificar que `direccion_inmueble` (Field L~174) reciba `suspicious` del Set unificado; si falta, agregar (patrón del apoderado).
   - Agregar `direccion_indice_corregido_por_codigo` a `WARNING_LABELS` con el texto propuesto.
5. **EDITAR** `.agents/skills/blindaje-anti-transposicion-ocr/SKILL.md` §8: nueva fila en tabla "Vivas" (ahora 5), actualizar título "Vivas (5)".

No se toca: `merge.ts`, `validate.ts` del poderBancoExtractor, `certificadoInmuebleValidate.ts`, schema `types.ts`, ninguna migración, ningún dato histórico.

## Confirmaciones que necesito antes de implementar

- ¿OK el tie-break "última aparición gana" en empate de índice? (Alternativa: primera aparición; me inclino por última por la razón dada.)
- ¿OK el nombre del warning `direccion_indice_corregido_por_codigo` y el texto del label?
- ¿OK dejar `menciones_direccion` intacto (recomendación §4)?
