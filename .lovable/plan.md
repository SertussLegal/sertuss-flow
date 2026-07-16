
## Aclaración previa — Créditos IA (Issue "402")

**Son cuentas distintas.** El `LOVABLE_API_KEY` que `procesar-cancelacion` (edge function) envía al Lovable AI Gateway consume el saldo de créditos del **workspace del proyecto Sertuss**. Los créditos que yo (agente) uso para editar código en este chat son otro pool (créditos de plan/build mode). Un 402 en producción no afecta mi capacidad de programar aquí.

**Evidencia del estado actual:** filtrando `list_ai_gateway_requests status=error` en los últimos 7 días → **0 errores**. Las últimas 27 llamadas son todas `success http 200` (`google/gemini-2.5-flash`, `google/gemini-2.5-pro`). El 402 que reportó el monitor **ya no se está reproduciendo**; fue un evento transitorio de saldo, ya recargado o consumido dentro de umbral. No hay bug de código que corregir — es operativo. Lo dejo fuera de este plan salvo que quieras que agregue un guard proactivo en la edge function para traducir 402 a un `biz("ai_credits_exhausted", ...)` con mensaje claro al notario (hoy probablemente cae como error genérico).

---

## Issue 1 — Cancelaciones bloqueadas para siempre (P0)

### Evidencia de campos escalares por warning

Los 4 warnings `*_menciones_incoherentes` que produce `validate.ts` y sobre los que `detectRequiereRevisionManual` bloquea:

| Warning | Escalar(es) a validar tras edición | Fuente |
|---|---|---|
| `rl_banco_menciones_incoherentes` | `poder_banco.poderdante.representante_legal_cedula` → `isCedulaValida` | ya implementado (líneas 1401-1405) |
| `apoderado_cedula_menciones_incoherentes` (Regla 6) | `poder_banco.apoderado_cedula` **Y** `poder_banco.apoderado.cedula` → `isCedulaValida` (ambos deben ser válidos y no vacíos; si sólo uno lo es, no se puede afirmar que el humano corrigió) | `validate.ts:170-171,215,245-246` |
| `inmueble_matricula_menciones_incoherentes` | `inmueble.matricula_inmobiliaria` → `sanitizeMatricula(v)` retorna string no vacío que matchea `^\d{1,4}[A-Z]?-\d{3,}$` | `procesar-cancelacion/index.ts:539-550`; formato canónico igual al que se imprime |
| `inmueble_direccion_menciones_incoherentes` | `inmueble.nomenclatura_predio` → no vacío, no `"NO_LEGIBLE"`, `length >= 8` (umbral mínimo para "algo con vía + número" sin sobrevalidar formato notarial) | no existe validador dedicado; criterio conservador |

### ¿Existe validador reutilizable?

- `isCedulaValida` — sí, exportado desde `validate.ts:39`.
- Matrícula — no hay un `isMatriculaValida`, pero `sanitizeMatricula` ya normaliza y devuelve `undefined` cuando el input es basura; **reusable con un wrapper booleano** `isMatriculaValida(v) := !!sanitizeMatricula(v) && /^\d{1,4}[A-Z]?-\d{3,}$/.test(sanitizeMatricula(v)!)`.
- Dirección — no existe, y **no debe** existir un validador estricto del formato notarial aquí (eso es trabajo del pipeline OCR + `direccionCandidatasSelect`). Criterio del guard: "el humano puso algo sustantivo, no lo dejó vacío ni con placeholder". Umbral: `length >= 8 && !== "NO_LEGIBLE" && !/^_+$/.test(v)`.

### Diseño de la función genérica

Ubicación: dentro de `procesar-cancelacion/index.ts`, junto a `detectRequiereRevisionManual` (los validadores viven ahí porque combinan pathing específico de `CancelacionData` con validators isomórficos ya importados).

```ts
// Wrapper booleano ya disponibles/nuevos, locales al archivo:
function isMatriculaValida(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = sanitizeMatricula(v);
  return !!s && /^\d{1,4}[A-Z]?-\d{3,}$/.test(s);
}
function isDireccionEditadaValida(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim();
  return s.length >= 8 && s !== "NO_LEGIBLE" && !/^_+$/.test(s);
}
function isCedulaEditadaValida(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "" && isCedulaValida(v);
}

// Tabla declarativa: warning → predicado sobre CancelacionData
type OverrideRule = {
  warning: string;
  canSuppress: (d: CancelacionData) => boolean;
};

const MANUAL_OVERRIDE_RULES: OverrideRule[] = [
  {
    warning: "rl_banco_menciones_incoherentes",
    canSuppress: (d) => isCedulaEditadaValida(
      (d.poder_banco as any)?.poderdante?.representante_legal_cedula,
    ),
  },
  {
    warning: "apoderado_cedula_menciones_incoherentes",
    canSuppress: (d) => {
      const pb = (d.poder_banco || {}) as any;
      // Ambos escalares deben ser válidos: el humano corrigió el plano Y el detalle.
      // Si sólo uno está bien, la incoherencia persiste dentro del propio data_final.
      return isCedulaEditadaValida(pb.apoderado_cedula)
          && isCedulaEditadaValida(pb.apoderado?.cedula);
    },
  },
  {
    warning: "inmueble_matricula_menciones_incoherentes",
    canSuppress: (d) => isMatriculaValida((d.inmueble as any)?.matricula_inmobiliaria),
  },
  {
    warning: "inmueble_direccion_menciones_incoherentes",
    canSuppress: (d) => isDireccionEditadaValida((d.inmueble as any)?.nomenclatura_predio),
  },
];

function applyManualOverrideExceptions(
  motivos: string[],
  data: CancelacionData,
): string[] {
  return motivos.filter((m) => {
    const rule = MANUAL_OVERRIDE_RULES.find((r) => r.warning === m);
    if (!rule) return true;              // warning no cubierto → sigue bloqueando
    return !rule.canSuppress(data);      // si el escalar quedó válido, se filtra
  });
}
```

**Integración en `detectRequiereRevisionManual`** — reemplaza el bloque actual líneas 1394-1406:

```ts
if (opts?.manualReviewConfirmed === true) {
  motivos = applyManualOverrideExceptions(motivos, extracted);
}
```

**Propiedades preservadas:**
- Comportamiento actual para `rl_banco_menciones_incoherentes` = idéntico (los tests existentes en `poderBancoValidateMencionesRL.test.ts` casos 8/9/10 siguen pasando: la condición `isCedulaValida(rlCed) && rlCed.trim() !== ""` es equivalente a `isCedulaEditadaValida`).
- Sin `manualReviewConfirmed`, cero cambio de comportamiento.
- Extensibilidad: agregar una regla nueva = una entrada en `MANUAL_OVERRIDE_RULES`.
- `paths` (los `NO_LEGIBLE` escalares del poder banco) siguen bloqueando siempre — la excepción sólo aplica a `motivos` de coherencia, no a NO_LEGIBLE crudo. Esto es correcto: NO_LEGIBLE en el escalar significa que el humano ni siquiera intentó editarlo.

### Tests (nuevos)

Archivo nuevo: `supabase/functions/procesar-cancelacion/index_manualOverride_test.ts` (Deno test, sigue el patrón de `index_manualReview_test.ts`).

Para cada uno de los 4 warnings, **3 casos** = 12 pruebas base:

| Grupo | Setup `data.*` | `manualReviewConfirmed` | `_coherencia_warnings` incluye el warning | Expectativa |
|---|---|---|---|---|
| A. Bloqueado sin confirmación | escalar válido | `false` | sí | `requiere===true`, warning en `motivos` |
| B. Desbloqueado con edición válida + confirmación | escalar válido (formato correcto) | `true` | sí (persistido) | `requiere===false`, warning filtrado |
| C. Sigue bloqueado con edición inválida + confirmación | escalar inválido o vacío | `true` | sí | `requiere===true`, warning aún en `motivos` |

Escalares "válidos" e "inválidos" concretos por warning:

- **RL banco** — válido: `"79382406"`; inválido: `""`, `"ABC"`, `"123"` (menos de 6).
- **Apoderado cédula (Regla 6)** — válido: ambos `apoderado_cedula="55069433"` y `apoderado.cedula="55069433"`; inválido: sólo uno de los dos válido (caso adicional relevante); inválido total: ambos vacíos.
- **Matrícula inmueble** — válido: `"50N-1234567"`; inválido: `""`, `"NO_LEGIBLE"`, `"CINCUENTA NORTE"` (verbalizado, sin patrón).
- **Dirección inmueble** — válido: `"CALLE 59 SUR - 84"` (≥8 chars); inválido: `""`, `"NO_LEGIBLE"`, `"____"`, `"CL 5"` (menos de 8).

**Casos de regresión** (mantener los existentes en `poderBancoValidateMencionesRL.test.ts` casos 1-10 y `poderBancoValidateMencionesApoderado.test.ts`): esos prueban `validatePoderBancoCoherencia` (extracción viva), independiente de `detectRequiereRevisionManual` (guard de generación). No cambian.

**Un caso extra de composición**: `_coherencia_warnings = [rl_banco, apoderado_cedula, inmueble_matricula, inmueble_direccion]`, 4 escalares corregidos + `manualReviewConfirmed=true` → `motivos` queda `[]`, `requiere===false`. Verifica que la función maneja varios warnings simultáneos correctamente.

Total: **12 + 1 = 13 casos nuevos**, más los ~10 existentes de RL banco que deben seguir verdes.

### Riesgo controlado

- Los warnings de coherencia se persisten en `data_final._coherencia_warnings` la primera vez que el OCR corre. NO se recalculan tras edición manual — el guard sólo filtra el efecto. Correcto para este ticket: la corrección estructural (recomputar warnings contra `data_final` editado) queda para otro sprint; hoy resolvemos el bloqueo terminal.
- La regla `apoderado_cedula` exige ambos escalares válidos porque `validate.ts:245-246` los evalúa como suspicious pair. Si aceptáramos sólo uno, un `data_final` internamente inconsistente pasaría el guard e imprimiría cédula errada en la minuta.
- `sanitizeMatricula` es tolerante (retorna el input crudo si no matchea), por eso la validación booleana requiere el regex adicional.

---

## Issue 3 — Nombre del deudor: UI ↔ minuta (P1)

### Diseño

Un solo cambio en `src/pages/CancelacionValidar.tsx`, líneas 455-465. Reemplazar:

```ts
const apellidos = String(d?.apellidos ?? "").toUpperCase() || undefined;
const nombres = String(d?.nombres ?? "").toUpperCase() || undefined;
const nombreVerbatim = String(d?.nombre ?? "").toUpperCase();
return {
  nombre: nombreVerbatim,
  apellidos, nombres, ...
};
```

por:

```ts
import { ensamblarNombreNotarial } from "@shared/ensamblarNombreNotarial";
// ...
const apellidos = String(d?.apellidos ?? "").toUpperCase() || undefined;
const nombres   = String(d?.nombres  ?? "").toUpperCase() || undefined;
const nombreVerbatim = String(d?.nombre ?? "").toUpperCase();
// Ensamblador determinista: mismo que usa `normalizeDeudores` en el backend.
// Cuando `nombres`+`apellidos` están poblados → "MARGARITA IBETH DIAZ GARCIA".
// Cuando no → fallback verbatim → retrocompat total con historicos.
const nombreEnsamblado = ensamblarNombreNotarial({ nombres, apellidos, nombre: nombreVerbatim });
return {
  nombre: nombreEnsamblado,
  apellidos, nombres, ...
};
```

### Respuestas a tus preguntas

**1. ¿Es seguro llamar `ensamblarNombreNotarial` desde el cliente?**

Sí. El helper es isomórfico puro (`supabase/functions/_shared/isomorphic/ensamblarNombreNotarial.ts`), sin imports de Deno/Supabase. Ya está importable vía alias `@shared` (confirmado por `src/shared/ensamblarNombreNotarial.test.ts:2` — `import { ensamblarNombreNotarial } from "@shared/ensamblarNombreNotarial"`). Su contrato está fijado por 8 tests unitarios; comportamiento con inputs vacíos y whitespace ya cubierto.

**Otros lectores del campo `nombre` en el mismo archivo:**
- Línea 443 (`hidratadosDesdeSingular`): fallback cuando NO hay `deudores[]` (payload legacy sin separación). Ese path recibe únicamente `partes.deudor_nombre` (string ya persistido, plano); NO debe ensamblarse — ahí `nombres`/`apellidos` no existen. Se deja sin tocar.
- Línea 1137: `deudoresArr` fallback en el render de "Partes" cuando `data.partes.deudores` está vacío — mismo caso legacy, sin cambios.
- Línea 1143: `writeDeudores` construye `deudor_nombre = next.map(d => d.nombre).join(" Y ")` para espejar el singular legacy. **Con el fix, `deudor_nombre` pasa a ser el ensamblado unido con " Y "** — lo cual es correcto: la BD ya venía almacenando el ensamblado en trámites recientes (`normalizeDeudores` en backend lo produce en `deudor_nombre` línea 1184 de index.ts).
- Consumidores de `data.partes.deudor_nombre` para chips/badges rojos (`cancelacionCriticalFields.ts`): sólo verifican `!!`. Sin impacto.

**2. ¿Sigue funcionando la invalidación al editar `nombre` a mano (línea 1163)?**

Sí, incluso mejor. La invalidación se dispara cuando `updateAt` recibe un `patch` con la clave `nombre` — o sea, cuando el usuario tipea en el input. Con el fix, el valor **inicial** del input ya es el ensamblado (`MARGARITA IBETH DIAZ GARCIA`); si el usuario no lo toca, `apellidos`/`nombres` sobreviven y el backend recompone el mismo string → **idempotente**. Si el usuario lo edita (ej. corregir un tilde), `apellidos`/`nombres` se invalidan y el backend imprime el verbatim editado. Comportamiento actual preservado en ambas ramas.

**3. Tests**

Archivo nuevo: `src/pages/CancelacionValidar.nombre.test.tsx` (o extender `CancelacionValidar.hydration.test.tsx` que ya existe).

Casos:

- **A. Hidratación con `apellidos`+`nombres` poblados** — payload `{ nombre: "DIAZ GARCIA MARGARITA IBETH", apellidos: "DIAZ GARCIA", nombres: "MARGARITA IBETH" }` → después de hidratar, `deudores[0].nombre === "MARGARITA IBETH DIAZ GARCIA"` (ensamblado).
- **B. Hidratación sin separados (legacy)** — payload `{ nombre: "JUAN PEREZ" }` sin `apellidos`/`nombres` → `deudores[0].nombre === "JUAN PEREZ"` (fallback verbatim, retrocompat).
- **C. Paridad UI↔backend** — dado el mismo `deudores[0]` post-hidratación, ejecutar mentalmente `normalizeDeudores(partes)` produce el mismo `nombre` → assert simbólico: `ensamblarNombreNotarial(hydrated)` === `normalizeDeudoresLikeString(hydrated)`. Ya existe test análogo en `src/shared/ensamblarNombreNotarial.test.ts` para el helper; aquí basta con verificar que la hidratación llama al helper.
- **D. Edición manual invalida separados** — simular `updateAt(0, { nombre: "JUAN PEREZ ROJAS" })` → el estado resultante tiene `apellidos===undefined && nombres===undefined && nombre==="JUAN PEREZ ROJAS"`.

### Riesgo

- Trámites histórcos con `deudores[]` que quedaron persistidos con `nombre` verbatim y `apellidos`/`nombres` poblados: al abrir el trámite después del deploy, el input mostrará el ensamblado en vez del verbatim. Si el notario ya había aprobado ese verbatim visualmente y no lo edita, `writeDeudores` reescribe `deudor_nombre` (singular espejo) al ensamblado en el próximo save → **cambio observable en BD** pero equivalente a lo que la minuta ya imprimía. Sin regresión legal.
- Auto-guardado en cascada (`SaveStatusContext`): la primera renderización tras el deploy dispara un save "cosmético" en trámites viejos. Aceptable — es exactamente la sincronización que estamos buscando.

---

## Orden de ejecución sugerido

1. **Issue 1** primero (P0, bloqueo terminal en producción). Cambio contenido: 1 archivo (`procesar-cancelacion/index.ts`) + 1 test file nuevo. Sin migración de datos.
2. **Issue 3** después. Cambio contenido: 1 archivo (`CancelacionValidar.tsx`) + 1 test file. Sin migración.
3. No tocar plantilla docx, no tocar backend de docx, no tocar `validate.ts` (los helpers Regla 5/6 siguen igual).

**Nada de esto genera migración de BD, edge function nueva, ni cambios en plantilla.** Todo es lógica isomórfica + tests.

Confirma o corrige antes de que pase a build mode.
