# De "bloqueo de generación" a "genera siempre + alertas + compuerta de descarga"

El documento siempre se genera y se previsualiza. Las alertas informan. Solo las decisiones pendientes detienen la **descarga**, nunca la vista ni la generación.

Aplica de hoy en adelante. Cero migraciones SQL. Los 7 trámites históricos en `requiere_revision_manual` se renderizan como "completado con alertas" y pasan a `completed` en su primer regen.

---

## Discrepancias encontradas (verificado contra el repo)

1. **No existe un patrón de "re-export en `src/shared/`".** `src/shared/` contiene **solo tests**. El código isomórfico se consume desde el frontend con el alias `@shared/*` → `supabase/functions/_shared/isomorphic/*` (ya usado en `CancelacionValidar.tsx:35-38`, `src/lib/reconcileData.ts:6`). El plan usa ese alias, no crea re-exports vacíos. Además `tsconfig.app.json` tiene una lista `include` **explícita** de archivos isomórficos: **hay que añadir `alertasCancelacion.ts` ahí o el typecheck del frontend no lo cubre.**
2. **La compuerta de descarga ya existe parcialmente.** `PdfViewerPane` ya acepta `blockDownload` + `onBlockedDownload` (usado hoy para "cambios sin guardar", `CancelacionValidar.tsx:1099-1107`). No hay que crear el mecanismo, hay que **componer una segunda razón de bloqueo** con precedencia definida.
3. **El gate no está solo en `heavyWork`: está en 4 lugares.** `generateAndUploadCancelacionDocs` (fail-safe interno, línea ~1368), rama `revision.requiere` de `heavyWork` (~3466), `catch` de `regen` (~2993, devuelve 409), y la acción `confirm_manual_review` completa (~2545-2625, más su propio `catch` de `ManualReviewRequiredError`). Los 4 se tocan.
4. **`detectRequiereRevisionManual` no se borra.** Sigue siendo la fuente de detección (NO_LEGIBLE + hard-block + recálculo escalar); solo deja de ser gate. `computeAlertas` la reemplaza como *lector de warnings crudos*, reutilizando `filterMotivosByScalarRecompute` (determinista, seguro). **No** reutiliza `applyManualOverrideExceptions` (ver corrección aprobada, punto 9).
5. **`confirm_manual_review` no es código muerto todavía en el frontend.** `CancelacionValidar.tsx` lo invoca en `handleConfirmManualReview` (línea 717) y lo pasa a dos hijos (líneas 1067, 1607). Borrar el bloque del backend sin tocar esos 3 call sites deja botones que fallan.
6. **La cláusula neutral ya existe** — `buildClausulaPagoHipoteca` (índex ~788) devuelve exactamente el texto neutral cuando `esCuantiaIndeterminada=false` y `valorRaw=""`. El requisito 1.2 se cumple **sin escribir prosa nueva**: basta con vaciar `valor_hipoteca_original` y forzar `valor_hipoteca_es_indeterminada=false` en la copia de render. Hay una trampa: `esIndeterminadaLegacy` (regex sobre `valorRaw`) — al vaciar el valor también se apaga, correcto.
7. **`hipoteca_garantia_abierta` es un flag distinto de `valor_hipoteca_es_indeterminada`** y sí puede ser legítimamente `true` con conflicto de cuantía. El blanking debe tocar **solo** `valor_hipoteca_original` + `valor_hipoteca_es_indeterminada`, dejando `hipoteca_garantia_abierta` intacto (es un hecho textual leído de la escritura, no una inferencia).
8. **`DESCARGADO_CON_ALERTAS` no se puede registrar con fidelidad total.** La descarga real es un `<a download>` en `PdfViewerPane:120-134`; el log se dispara en el click, no en la finalización del download. Es aceptable pero hay que decirlo: el log significa "el usuario pidió la descarga", no "el archivo llegó".
9. **`applyManualOverrideExceptions` / `MANUAL_OVERRIDE_RULES` quedan sin llamador de producción.** Verificado con grep: hoy el único llamador real es `detectRequiereRevisionManual` (`index.ts:1529`, tras `manualReviewConfirmed`); todo lo demás son **tests** (`scalarGatingRecompute.test.ts:39`, `poderBancoValidateCandidatosNatural.test.ts:108`, `cuantiaConflicto.test.ts:129-153`) y el re-export de `index.ts:1450-1453`. **Recomendación: no eliminar en Fase 1.** Motivo: `hardBlockRules.ts` exporta también `HARD_BLOCK_WARNING_SUFFIXES` (re-exportado desde `validate.ts`), que sigue siendo la definición de "qué es un warning duro" y que `computeAlertas` necesita. Borrar la función y sus reglas en el mismo commit que desmonta el gate mezcla dos cambios de riesgo distinto. Plan: dejar `MANUAL_OVERRIDE_RULES` y `applyManualOverrideExceptions` **sin llamadores, marcados `@deprecated` con nota "sin uso desde el rediseño de alertas — eliminar en Fase 2"**, eliminar el re-export de `index.ts`, y eliminar `index_manualOverride_test.ts`. Los 3 tests de frontend que los invocan se ajustan (ver 1.6). Si el dueño prefiere borrado total en Fase 1, es un cambio mecánico adicional de ~200 líneas; queda a su decisión.
10. **`previewStale` NO es una detección de "documento desactualizado".** Verificado en `CancelacionValidar.tsx:395` y `:576-612`: es un **flag de fallo** — se pone en `true` únicamente cuando el `regen` disparado por el autosave falla o colisiona con otro en vuelo. No compara datos contra documento. Al eliminar el regen del autosave (cambio mayor aprobado), `previewStale` **deja de tener significado** y no sirve para alimentar el estado del botón. Hay que derivar `docActualizado` de verdad (ver 1.4). Ver también la limitación de recarga de página documentada allí.


---

## FASE 1 — Backend + salvaguardas (despliegue atómico)

### Orden de implementación

```text
1. alertasCancelacion.ts (módulo puro, sin dependencias nuevas)
2. tests de computeAlertas + applyPendingDecisionBlanks   ← rojo→verde antes de tocar index.ts
3. index.ts: blanking dentro de generateAndUploadCancelacionDocs + quitar throw
4. index.ts: heavyWork / regen / confirm_manual_review
5. Frontend: compuerta de descarga + aviso de sección poder + limpiar confirm_manual_review
6. alertasCoverage.test.ts + reescritura de tests Regla 8
7. bunx vitest run + tsgo + deploy
```

Los pasos 3-5 deben salir en el **mismo** despliegue: no puede existir una ventana donde el doc se genere sin gate de generación y sin gate de descarga.

---

### 1.1 `supabase/functions/_shared/isomorphic/alertasCancelacion.ts` (nuevo)

Módulo puro. Prohibido importar Deno, React, cliente de BD.

```ts
export type CategoriaAlerta = "prioritaria" | "importante" | "informativa";
export type SeccionAlerta = "poder" | "inmueble" | "hipoteca" | "partes" | "documento";

export interface Alerta {
  codigo: string;
  categoria: CategoriaAlerta;
  seccion: SeccionAlerta;
  bloqueaDescarga: boolean;   // === (categoria === "prioritaria")
  label: string;
  detalle?: Record<string, unknown>;
}

export function computeAlertas(
  dataFinal: Record<string, unknown> | null | undefined,
): Alerta[];
```

Firma: **un solo argumento**. `_avisos_procesamiento` vive *dentro* de `data_final` (verificado: `heavyWork` lo escribe como `dataConAvisos`), pasarlo aparte invita a que se desincronicen.

Fuentes leídas (las tres actuales + avisos):
- `poder_banco._coherencia_warnings`
- `inmueble._coherencia_warnings`
- `hipoteca_anterior._coherencia_warnings`
- `_avisos_procesamiento.*`
- centinelas `"NO_LEGIBLE"` en los 6 paths de `detectRequiereRevisionManual` (se **reutiliza** esa lista exportándola desde `index.ts` o moviéndola al módulo nuevo — preferible moverla, es una constante pura).
- `poder_banco._confianza.*` para las informativas.
- `analisis_legal.aplica_ley_546`.

Antes de clasificar aplica, en este orden:
1. `filterMotivosByScalarRecompute(...)` — importado de `scalarGatingRecompute.ts`, tal cual hoy.
2. `applyManualOverrideExceptions(motivos, data)` — **ahora incondicional** (ver discrepancia 4).
3. Dedupe por `codigo`.

Labels: `WARNING_LABELS` de `validate.ts` es la fuente. Los códigos que no existan ahí (los de `_avisos_procesamiento`) se añaden a **un mapa nuevo local** `AVISO_LABELS` en `alertasCancelacion.ts` — no se contamina `WARNING_LABELS`, que es catálogo de warnings de validación.

#### Tabla de clasificación — REQUIERE APROBACIÓN HUMANA

| Código | Categoría | Sección | Motivo |
|---|---|---|---|
| `apoderado_natural_candidatos_requiere_confirmacion` (sin `apoderado.candidato_confirmado_cedula` presente en la lista `candidatos_natural` vigente) | prioritaria | poder | Decisión pendiente: quién es el apoderado |
| `cuantia_conflicto_candidatos_no_resuelto` (con `cuantia_origen !== "manual"`) | prioritaria | hipoteca | Decisión pendiente: cuál es el monto |
| centinela `NO_LEGIBLE` en cualquiera de los 6 paths del poder | prioritaria | poder | Dato ausente, sale en blanco |
| `apoderado_cedula_no_legible` / `escritura_poder_no_legible` / `fecha_poder_no_legible` | prioritaria | poder | Misma condición vista desde `_coherencia_warnings` (dedupe con la fila anterior por sección+campo) |
| `apoderado_cedula_menciones_incoherentes` | importante | poder | Verificar contra PDF |
| `rl_banco_menciones_incoherentes` | importante | poder | Verificar contra PDF |
| `inmueble_matricula_menciones_incoherentes` | importante | inmueble | Verificar contra PDF |
| `inmueble_direccion_menciones_incoherentes` | importante | inmueble | Verificar contra PDF |
| `apoderado_cedula_divergencia_lecturas` | importante | poder | Doble lectura discrepa |
| `escritura_poder_divergencia_lecturas` | importante | poder | Doble lectura discrepa |
| `fecha_poder_divergencia_lecturas` | importante | poder | Doble lectura discrepa |
| `apoderado_cedula_placeholder` | importante | poder | Alucinación conocida, verificar |
| `apoderado_nombre_duplicidad_cruzada` | importante | poder | Cruce inter-trámite |
| `apoderado_cedula_duplicidad_cruzada` | importante | poder | Cruce inter-trámite |
| `poder_entidad_nit_incoherente` | importante | poder | El poder puede no aplicar — verificar |
| `poder_entidad_nombre_incoherente` | importante | poder | Idem |
| `escritura_num_incoherente` / `fecha_incoherente` | importante | poder | Discrepancia entre bloques |
| `apoderado_coincide_con_rl_banco` | importante | poder | Probable confusión OCR |
| `apoderado_multiple_firmantes_ambiguo` | importante | poder | Se usó el primero |
| `_avisos_procesamiento.direccion_catastral_ocr` | importante | inmueble | Sin detección automática |
| `_avisos_procesamiento.escritura_truncada` | importante | documento | Se analizó parcialmente |
| `*_confianza_baja` (4 códigos) | informativa | poder | Autorreporte de Gemini, nunca ha disparado bien |
| `cedula_formato_invalido` | informativa | partes | Higiene de formato |
| `direccion_indice_corregido_por_codigo` | informativa | inmueble | El sistema ya eligió |
| `apoderado_nombre_divergencia_plano_anidado` / `apoderado_cedula_divergencia_plano_anidado` | informativa | poder | Ya resuelto a favor del humano |
| `aplica_ley_546 === true` | informativa | hipoteca | Contexto legal |

Regla de default para códigos futuros no clasificados: **`importante`**, sección `documento`. Nunca `prioritaria` por defecto (bloquear por accidente es peor), nunca silencioso.

**Nota sobre 3 prioritarias, no más.** El requisito pedía que las prioritarias fueran "decisiones pendientes". Los `*_menciones_incoherentes` y `*_divergencia_lecturas`, que hoy son hard-block, bajan a importante — eso es el corazón del rediseño y el mayor cambio de riesgo. Queda explícito para aprobación.

---

### 1.2 `applyPendingDecisionBlanks(data)` — mismo módulo

```ts
export function applyPendingDecisionBlanks<T extends Record<string, unknown>>(
  data: T,
): { data: T; aplicados: string[] };
```

Copia profunda superficial por rama (spread de `poder_banco`, `poder_banco.apoderado`, `hipoteca_anterior`) — **nunca muta la entrada**. Se llama dentro de `generateAndUploadCancelacionDocs`, sobre el resultado del sync de apoderado y **antes** de `buildDocxVars`. Su salida no se persiste jamás en `data_final`.

Reglas:

1. **NO_LEGIBLE global.** Recorrido recursivo: cualquier string `=== "NO_LEGIBLE"` → `undefined`. No se limita a los 6 paths conocidos (el prompt puede emitirlo en `menciones_direccion[].valor`, ya documentado). `nullGetter` de Docxtemplater pinta `___________`.
2. **Candidato de apoderado sin confirmar.** Condición: existe `poder_banco.apoderado.candidatos_natural` con ≥2 entradas y `candidato_confirmado_cedula` ausente o no coincidente con ninguna. Acción: vaciar `poder_banco.apoderado_nombre`, `poder_banco.apoderado_cedula` (planos) **y** `poder_banco.apoderado.nombre`, `.cedula`. `classifyApoderado` con `apo.tipo` intacto pero sin nombre/cédula degrada a tags de prosa vacíos — verificar en el test que `getProsaBanco(...).renderComparecencia` no imprime basura ni la palabra `undefined`.
3. **Conflicto de cuantía sin resolver.** Condición: `hipoteca_anterior.cuantia_origen === "conflicto_candidatos_no_resuelto"` (constante `CUANTIA_CONFLICTO_ORIGEN`). Acción sobre la copia:
   - `valor_hipoteca_original = ""`
   - `valor_hipoteca_es_indeterminada = false`
   - **no tocar** `hipoteca_garantia_abierta` (discrepancia 7)

   Efecto verificado en `buildDocxVars`: `esCuantiaIndeterminada=false` + `valorRaw=""` → `clausula_pago_hipoteca` = texto neutral, `valor_hipoteca_letras_o_indeterminado` = vacío, `valor_hipoteca_original`/`_letras`/`_numeros` = `undefined`, `valor_hipoteca_es_indeterminada` = `undefined`. Ningún tag afirma indeterminada.

`aplicados` devuelve los códigos de blanking activados, para el log `GENERADO_CON_ALERTAS`.

---

### 1.3 Desmontar la compuerta de generación — `supabase/functions/procesar-cancelacion/index.ts`

| Ubicación (línea aprox. hoy) | Cambio |
|---|---|
| `ManualReviewRequiredError` (~1343) | Eliminar la clase. Grep de residuos en los 4 sitios de `catch`. |
| `generateAndUploadCancelacionDocs` (~1357-1372) | Quitar la llamada a `detectRequiereRevisionManual` y el `throw`. Insertar `applyPendingDecisionBlanks` tras el sync de apoderado (~1391) y antes de `buildDocxVars` (~1401). Ampliar el retorno a `{ minutaPath, certPath, alertasActivas, blanksAplicados }`. |
| `heavyWork` rama `revision.requiere` (~3466-3495) | Eliminar la rama. Camino único: generar + `status:"completed"`. Sustituir el insert `system_events` `resultado:"bloqueado"` por `evento:"procesar-cancelacion.generado_con_alertas"`, `resultado:"parcial"`, `detalle:{alertas, blanks}` — **solo si** `alertasActivas.length > 0`. Sustituir el `activity_logs` `MANUAL_REVIEW_REQUIRED` por `GENERADO_CON_ALERTAS`. No escribir `revision_manual_requerida` ni sus timestamps. |
| `regen` `catch` (~2993-3011) | Eliminar la rama `instanceof ManualReviewRequiredError` y la respuesta 409. Regen siempre regenera y persiste `url_*`. **Verificado: regen no llama `consume_credit_v2`** (el cobro está solo en el modo normal, ~3040) — no se introduce cobro nuevo. Añadir `GENERADO_CON_ALERTAS` cuando aplique. |
| Acción `confirm_manual_review` (~2412-2625) | Eliminar el bloque completo y su valor del union `action?:`. |
| Columnas `revision_manual_*` | No se escriben más. No se borran de BD. Cero SQL. |

**Compatibilidad de status legacy** (frontend, `CancelacionValidar.tsx`): tratar `row.status === "requiere_revision_manual"` como `completed` en todos los branches de render (líneas 948, 966, 1031, 1605). Si el row no tiene `url_minuta_generada`, el visor muestra su estado vacío actual y el usuario dispara un regen normal, que lo deja en `completed`. Se retira el guard de autosave añadido en la sesión anterior (`CancelacionValidar.tsx:559-568`), que deja de tener sentido: ya no hay 409.

`src/pages/Cancelaciones.tsx` (líneas 63, 119, 133-151, 246): el badge "Bloqueada" y el orden por `revision_manual_requerida` se mantienen **solo** como etiqueta histórica de lectura; ningún trámite nuevo entrará ahí. `Cancelaciones.test.tsx` sigue verde sin cambios.

---

### 1.4 Compuerta de DESCARGA (mismo despliegue)

`src/pages/CancelacionValidar.tsx`:

```ts
const alertas = useMemo(() => computeAlertas(dataFinal), [dataFinal]);
const prioritarias = alertas.filter(a => a.bloqueaDescarga);
```

Importado como `import { computeAlertas } from "@shared/alertasCancelacion"` (alias existente; añadir el archivo al `include` de `tsconfig.app.json`).

`PdfViewerPane` — se reutiliza tal cual, componiendo las dos razones con precedencia:

```
blockDownload = isDirty || prioritarias.length > 0
onBlockedDownload:
  1º  isDirty              → toast actual "cambios sin guardar" (sin cambios)
  2º  prioritarias.length  → abre <DecisionesPendientesDialog>
```

`isDirty` primero: pedir decisiones sobre datos no guardados sería confuso.

`src/components/cancelaciones/DecisionesPendientesDialog.tsx` (nuevo, mínimo en Fase 1): lista las prioritarias con label + instrucción concreta por código:
- candidatos → "Selecciona el apoderado en la sección Poder" + botón que hace `scrollIntoView` al banner `ApoderadoCandidatosBanner` existente.
- conflicto de cuantía → "Escribe el monto o confírmalo como indeterminado" + scroll al recuadro ámbar de `cuantia_candidatos` ya implementado.
- NO_LEGIBLE → "Completa a mano el/los campo(s): …" + scroll a la sección Poder.

El scroll usa `ref` + `scrollIntoView`; no requiere re-arquitectura porque ambos destinos ya son bloques renderizados en la misma página.

**Bitácora** (`activity_logs`, insert directo con el cliente de usuario, no bloqueante):
- `DESCARGA_BLOQUEADA_DECISIONES` — al abrir el diálogo. `metadata: { codigos, doc: activeDoc }`.
- `DESCARGADO_CON_ALERTAS` — en `handleDownload` exitoso cuando hay importantes activas. `metadata: { codigos, doc }`. Sin modal de confirmación.
- `GENERADO_CON_ALERTAS` — lo escribe el backend (1.3).

Semántica honesta de `DESCARGADO_CON_ALERTAS`: registra la *intención* de descarga (click), no la finalización (discrepancia 8).

---

### 1.5 Aviso de sección para Poder ilegible

En la sección Poder del formulario, banner reutilizando el patrón de `PoderBannersV5` / el banner ámbar de `direccion_catastral_ocr` ya presente (`CancelacionValidar.tsx:1004`). Fuente: `alertas.filter(a => a.seccion === "poder" && a.categoria === "prioritaria")`. Texto: lista de qué campos no se pudieron leer + "salen en blanco en el documento; complétalos aquí". Pulido visual en Fase 2.

---

### 1.6 Tests

| Archivo | Acción |
|---|---|
| `src/shared/hardBlockCoverage.test.ts` | **Renombrar** a `src/shared/alertasCoverage.test.ts` y reescribir. Nuevo invariante: para cada código con `categoria === "prioritaria"` deben existir (a) regla en `applyPendingDecisionBlanks`, (b) label resoluble, (c) `seccion` asignada. Se conserva el escaneo estático de literales sobre `SOURCES` (mismo mecanismo, misma lista de archivos + `alertasCancelacion.ts`) y la aserción H4 anti-template-literal. Todo código emitido debe estar clasificado por `computeAlertas` (no caer en el default silenciosamente → el default debe ser detectable en el test). |
| `src/shared/poderBancoValidateCandidatosNatural.test.ts` (7 casos Regla 8) | Reescribir aserciones: la *detección* no cambia (prohibido tocar `validate.ts`); cambia el efecto. "Sin candidato confirmado" → alerta prioritaria activa + `applyPendingDecisionBlanks` vacía nombre/cédula + prosa vacía. "Con candidato confirmado" → passthrough, alerta ausente. |
| `src/shared/alertasCancelacion.test.ts` (nuevo) | `computeAlertas`: cada categoría; las 3 fuentes de `_coherencia_warnings` + avisos; dedupe; recálculo escalar apaga; override manual apaga; código desconocido → `importante`. |
| `src/shared/pendingDecisionBlanks.test.ts` (nuevo) | NO_LEGIBLE anidado → `undefined`; conflicto de cuantía → **snapshot del texto de `buildClausulaPagoHipoteca`** afirmando que es el neutral y que NUNCA contiene "CUANTÍA INDETERMINADA"; candidatos → prosa vacía; datos completos → objeto idéntico (identidad estructural, sin mutación de la entrada). |
| `supabase/functions/procesar-cancelacion/index_manualOverride_test.ts` / `index_manualReview_test.ts` | Adaptar: los casos que afirman `ManualReviewRequiredError` o `requiere:true → no genera` pasan a afirmar "genera + alerta". `detectRequiereRevisionManual` sobrevive como detector puro; sus tests de detección se conservan. |
| `src/shared/cuantiaConflicto.test.ts`, `certificadoInmuebleValidate.test.ts`, `scalarGatingRecompute.test.ts` | Sin cambios esperados (detección intacta). Si alguno rompe, es señal de que se tocó lógica prohibida. |

Verificación: `bunx vitest run` completo (435 verdes hoy — la meta es ≥435 con las reescrituras) + `tsgo`.

---

### Caso de aceptación real

Trámite nuevo con **conflicto de cuantía Y poder multi-candidato**:
1. `heavyWork` termina en `status:"completed"` con `url_minuta_generada` poblado. Sin `requiere_revision_manual`.
2. El `.docx` abre en el visor con: apoderado en blanco (`___________`), cláusula de pago **neutral**, sin la frase "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA", sin la palabra "NO_LEGIBLE" en ningún lado.
3. La UI muestra 2 alertas prioritarias + las importantes que haya.
4. "Descargar .docx" no descarga: abre el diálogo con las 2 decisiones y sus enlaces. `activity_logs` recibe `DESCARGA_BLOQUEADA_DECISIONES`.
5. Se elige candidato + se escribe el monto → guardar → regen (sin cobro) → doc completo, descarga habilitada, `DESCARGADO_CON_ALERTAS` si quedan importantes.

Un trámite legacy en `requiere_revision_manual` debe abrir sin romper y pasar a `completed` tras el primer regen.

---

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| **Bajar `*_menciones_incoherentes` y `*_divergencia_lecturas` de bloqueante a importante** deja pasar transposiciones de dígitos que hoy se frenan. Es el riesgo mayor del rediseño. | Decisión de producto explícita en la tabla 1.1, requiere aprobación firmada. La detección no se toca; la alerta es visible y se registra en `activity_logs`. |
| Un `.docx` incompleto se descarga en la ventana entre despliegue de backend y frontend. | Fase 1 sale atómica (backend + gate de descarga en el mismo deploy). Regla de secuencia explícita en el orden de implementación. |
| Blanking que sí muta `data_final` y borra datos del usuario. | Copia por rama; test de identidad estructural; `applyPendingDecisionBlanks` se llama solo dentro de `generateAndUploadCancelacionDocs`, nunca en el camino de persistencia. |
| `classifyApoderado` con nombre/cédula vacíos imprime `undefined` o prosa rota. | Test de prosa vacía sobre `renderComparecencia`/`renderAntefirma`; snapshot. |
| `applyManualOverrideExceptions` incondicional apaga alertas antes de tiempo. | Sus predicados exigen escalar con formato válido (incluido el anti-placeholder). Test dedicado por regla. |
| Botones huérfanos de `confirm_manual_review` en el frontend. | Los 3 call sites (717, 1067, 1607) se eliminan en el mismo commit que el bloque del backend. |
| Regen empieza a cobrar créditos por algún camino nuevo. | Verificado hoy: `consume_credit_v2` solo se invoca en el modo normal. Se añade una aserción de grep en la checklist de revisión, no un test. |

## Restricciones respetadas

No se tocan: pipeline de extracción, las 7 capas anti-alucinación, `detectarConflictoCuantia`, `validate.ts`, sistema de créditos, RLS, plantillas `.docx`. Código compartido nuevo en `_shared/isomorphic/`, consumido con el alias `@shared/*`. Cero migraciones SQL.

## FASE 2 — Interfaz (ciclo Plan→Build aparte)

Alcance, sin diseñar aquí: panel lateral único de alertas con 3 pestañas y contador persistente; badge de estado unificado (sin resucitar el bug C8 de mensajes contradictorios entre "Revisión manual pendiente" y el chip "Guardado"); redistribución con textos secundarios movidos a tooltips (referencia Figma Lantus.AI sobre los estilos del design system Sertuss actual); pulido del diálogo de descarga y del aviso de sección del poder. Las alertas localizadas en campos se mantienen como están.
