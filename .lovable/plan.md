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
10. **`previewStale` NO es una detección de "documento desactualizado".** Verificado en `CancelacionValidar.tsx:395` y `:576-612`: es un **flag de fallo** — se pone en `true` únicamente cuando el `regen` disparado por el autosave falla o colisiona con otro en vuelo. No compara datos contra documento. Al eliminar el regen del autosave (cambio mayor aprobado), `previewStale` **deja de tener significado** y no sirve para alimentar el estado del botón. Hay que derivar `docActualizado` de verdad (ver 1.4): arranca en `false` al montar, se gana tras un regen exitoso en la sesión y se pierde al editar o recargar.


---

## FASE 1 — Backend + salvaguardas (despliegue atómico)

### Orden de implementación

```text
1. alertasCancelacion.ts (módulo puro, sin dependencias nuevas)
2. tests de computeAlertas + applyPendingDecisionBlanks   ← rojo→verde antes de tocar index.ts
3. index.ts: blanking dentro de generateAndUploadCancelacionDocs + quitar throw
4. index.ts: heavyWork / regen / confirm_manual_review
5. Frontend: función pura del botón + máquina de estados en la UI + autosave sin regen + aviso de sección poder + limpiar confirm_manual_review
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
1. `filterMotivosByScalarRecompute(...)` — importado de `scalarGatingRecompute.ts`, tal cual hoy. Recálculo determinista con datos frescos: seguro.
2. Dedupe por `codigo`.

**`applyManualOverrideExceptions` NO se llama.** Sus predicados apagan el warning en cuanto el escalar tiene *formato* válido, y el dato del OCR casi siempre tiene formato válido aunque sea el equivocado — las alertas `*_menciones_incoherentes` se auto-apagarían al instante y nunca serían visibles (caso real: matrícula `50S-40096988` vs `50S-40096988B` del trámite e07c5d5a jamás habría mostrado alerta).

**Cómo se apaga cada categoría:**
- **Prioritarias** — solo por su condición explícita de resolución, ya escrita en la tabla: candidato confirmado presente en la lista vigente / `cuantia_origen === "manual"` o monto real escrito / campo `NO_LEGIBLE` completado a mano.
- **Importantes** — **no se apagan en Fase 1.** Son notas de verificación: la discrepancia existió en el documento fuente y el abogado debe saberlo hasta el final, aunque haya editado el campo. Un futuro "marcar como verificada" queda fuera de alcance (Fase 2 o posterior).
- **Informativas** — igual: permanecen.

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
| `cedula_formato_invalido` | **importante** | partes | Una cédula con formato inválido en un documento legal no es higiene menor |
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

**Compatibilidad de status legacy** (frontend, `CancelacionValidar.tsx`): tratar `row.status === "requiere_revision_manual"` como `completed` en todos los branches de render (líneas 948, 966, 1031, 1605). Si el row no tiene `url_minuta_generada`, el botón principal arranca en "Generar Minuta" y el primer clic lo deja en `completed`.

**El autosave deja de regenerar** (cambio mayor aprobado): en `persistData` (`CancelacionValidar.tsx:~540-615`) se elimina la llamada a `procesar-cancelacion {regen:true}` y toda su lógica de freno — el guard de `revision_manual_requerida` (líneas 559-568), `isRegenInFlightRef`, `parseManualReviewError` y las ramas de `previewStale`. El autosave **solo persiste datos**. La generación pasa a ser siempre un acto explícito del usuario.

Se mantiene: la **primera** previsualización se genera automáticamente al terminar el procesamiento inicial (`heavyWork`), con blancos honestos si hay decisiones pendientes. El usuario siempre aterriza viendo el documento.

`src/pages/Cancelaciones.tsx` (líneas 63, 119, 133-151, 246): el badge "Bloqueada" y el orden por `revision_manual_requerida` se mantienen **solo** como etiqueta histórica de lectura; ningún trámite nuevo entrará ahí. `Cancelaciones.test.tsx` sigue verde sin cambios.

---

### 1.4 Botón principal con máquina de estados (mismo despliegue)

Sustituye al diálogo modal de descarga. Un solo botón narra el ciclo completo. El botón "Regenerar" actual (`CancelacionValidar.tsx:949-958`) se absorbe en él.

#### Función pura — `src/lib/botonMinutaEstado.ts` (nuevo)

Diseñada como función pura testeable, nada de lógica inline en el componente.

```ts
export type EstadoBotonMinuta =
  | "acciones_pendientes"   // ≥1 alerta prioritaria
  | "generar"               // sin prioritarias, doc ausente o desactualizado
  | "cargando"              // regen en vuelo
  | "descargar";            // doc presente, al día, sin prioritarias

export function deriveEstadoBotonMinuta(input: {
  prioritarias: number;
  docExiste: boolean;
  docActualizado: boolean;
  isDirty: boolean;
  generando: boolean;
}): { estado: EstadoBotonMinuta; disabled: boolean; contador?: number };
```

Precedencia: `generando` → `cargando` (disabled). Luego `prioritarias > 0` → `acciones_pendientes` (habilitado; despliega el listado). Luego `!docActualizado || isDirty` → `generar` (`disabled` mientras `saving`, para que el guardado persista antes de generar). Si no, `descargar`.

`isDirty` fuerza `generar`, no `descargar`: nunca se descarga un doc que no refleja lo que hay en pantalla. Esto reemplaza el toast actual de "cambios sin guardar" de `PdfViewerPane` para este botón.

#### Regla de oro del botón — "Descargar se gana en la sesión, nunca se asume"

1. Al montar la página de un trámite, el estado inicial es siempre **"generar"** (o **"acciones_pendientes"** si hay prioritarias). Nunca "descargar", aunque `url_minuta_generada` exista.
2. "Descargar" solo se alcanza tras una generación exitosa **dentro de la sesión actual** (`regen` → éxito → fijar snapshot).
3. Editar cualquier campo tras generar → `docActualizado=false` → vuelve a "generar".
4. Cerrar o recargar la página → `docActualizado` se resetea a `false` → vuelve al punto 1.

#### `docActualizado` — simplificado a sesión

`previewStale` no sirve. Propuesta mínima, sin SQL:
- `lastGeneratedSnapshotRef` — se fija con el mismo `JSON.stringify(data)` que ya usa `lastSavedSnapshotRef` (`CancelacionValidar.tsx:400`), justo tras un regen exitoso.
- `docActualizado` arranca en `false` al montar el componente. No importa si `url_minuta_generada` existe: al abrir siempre hay que regenerar para garantizar frescura.
- `docActualizado = lastGeneratedSnapshotRef.current === snapshotActual`.
- No hay limitación de recarga: por diseño, recargar siempre reinicia el estado del botón.

#### `docExiste` en `deriveEstadoBotonMinuta`

Con la regla de oro, `docExiste` deja de importar para el estado inicial (nunca se asume "descargar" al montar). Se conserva como guarda defensiva: si el ref marca `docActualizado=true` pero `docExiste=false`, el estado debe caer a "generar" por seguridad. Si el dueño prefiere la firma mínima, se puede eliminar el parámetro; queda a su decisión.

#### Previsualización

La previsualización **no cambia**: el visor sigue mostrando el documento existente al abrir (el de la primera generación automática o el último generado). Lo que se gana con el botón es la garantía de frescura de la **descarga**, no de la vista.



#### Un botón para minuta + certificado — MARCADO PARA APROBACIÓN

**Propuesta: un solo botón, gobernado por la pestaña activa.** Justificación en el código: `generateAndUploadCancelacionDocs` genera **siempre los dos** documentos en la misma llamada (`index.ts:1401-1420`) y `regen` persiste ambos `url_*` juntos. Un botón por pestaña duplicaría UI para una acción que ya es atómica en el backend. Por tanto:
- Estados "Acciones pendientes" / "Generar" / "Cargando" son **globales** (idénticos en ambas pestañas — reflejan un solo regen).
- El estado "Descargar" es **contextual**: descarga el documento de la pestaña activa (`activeDoc`), reutilizando `PdfViewerPane.handleDownload`.
- Etiqueta: "Generar documentos" en vez de "Generar Minuta", ya que produce ambos. (Si el dueño prefiere el literal "Generar Minuta", es solo texto.)

#### Listado de acciones pendientes

Popover anclado al botón (`components/ui/popover`, ya en el proyecto), **no modal bloqueante**. Componente nuevo `src/components/cancelaciones/AccionesPendientesList.tsx`. Una entrada por alerta prioritaria con: label, instrucción concreta, y botón de salto (`ref` + `scrollIntoView`):
- candidatos → `ApoderadoCandidatosBanner` existente.
- conflicto de cuantía → recuadro ámbar de `cuantia_candidatos` ya implementado.
- `NO_LEGIBLE` → sección Poder, nombrando los campos ilegibles.

Ambos destinos ya son bloques renderizados en la misma página; el salto no requiere re-arquitectura.

#### Transiciones

- Resolver la última prioritaria (vía autoguardado del dato) → el botón pasa solo de "Acciones pendientes" a "Generar documentos", sin recarga: `computeAlertas` corre en `useMemo` sobre el `data` en memoria.
- Editar cualquier campo tras generar → `docActualizado=false` → vuelve a "Generar documentos".
- Clic en "Generar documentos" → `cargando` → invoca `{regen:true, manualOverrides:data}` → al éxito fija `lastGeneratedSnapshotRef`, `setViewerKey(k=>k+1)`, invalida la query → "Descargar".
- Recargar o cerrar la página → `docActualizado` se resetea a `false` → el botón vuelve a "Generar documentos" (o "Acciones pendientes" si hay prioritarias).


#### Bitácora (`activity_logs`, insert no bloqueante)

- `ACCIONES_PENDIENTES_MOSTRADAS` — al desplegar el listado. `metadata: { codigos, doc: activeDoc }`.
- `DESCARGADO_CON_ALERTAS` — en el clic de Descargar cuando hay importantes activas. `metadata: { codigos, doc }`. Sin modal de confirmación.
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
| `src/shared/alertasCancelacion.test.ts` (nuevo) | `computeAlertas`: cada categoría; las 3 fuentes de `_coherencia_warnings` + avisos; dedupe; recálculo escalar determinista apaga; **caso inverso obligatorio: editar el escalar a un valor con formato válido NO apaga una alerta importante** (`*_menciones_incoherentes` permanece); código desconocido → `importante`. Sin caso "override manual apaga" — ese mecanismo desaparece. |
| `src/shared/pendingDecisionBlanks.test.ts` (nuevo) | NO_LEGIBLE anidado → `undefined`; conflicto de cuantía → **snapshot del texto de `buildClausulaPagoHipoteca`** afirmando que es el neutral y que NUNCA contiene "CUANTÍA INDETERMINADA"; candidatos → prosa vacía; datos completos → objeto idéntico (identidad estructural, sin mutación de la entrada). |
| `src/lib/botonMinutaEstado.test.ts` (nuevo) | Máquina de estados: los 4 estados y su precedencia; `generando` gana sobre todo; `prioritarias>0` gana sobre `docActualizado`; `isDirty` fuerza `generar`, nunca `descargar`; montaje inicial con `docExiste=true` y `url_minuta_generada` poblado → estado `generar`, nunca `descargar`; `disabled` correcto en `cargando` y en `generar` mientras `saving`; contador `N` igual al número de prioritarias. |
| `supabase/functions/procesar-cancelacion/index_manualOverride_test.ts` | **Eliminar** — su sujeto (`applyManualOverrideExceptions` vía `manualReviewConfirmed`) desaparece del flujo. |
| `supabase/functions/procesar-cancelacion/index_manualReview_test.ts` | Adaptar: los casos que afirman `ManualReviewRequiredError` o `requiere:true → no genera` pasan a afirmar "genera + alerta". `detectRequiereRevisionManual` sobrevive como detector puro; sus tests de detección se conservan. |
| `src/shared/scalarGatingRecompute.test.ts`, `poderBancoValidateCandidatosNatural.test.ts`, `cuantiaConflicto.test.ts` | Invocan `applyManualOverrideExceptions` directamente (líneas 39, 108, 129-153). Al quedar la función `@deprecated` sin llamadores, esas aserciones se **reemplazan** por la aserción equivalente en el modelo nuevo: la condición explícita de resolución de la alerta prioritaria (candidato confirmado / `cuantia_origen="manual"`). Los casos de detección pura no se tocan. |
| `certificadoInmuebleValidate.test.ts` | Sin cambios esperados (detección intacta). Si rompe, es señal de que se tocó lógica prohibida. |

Verificación: `bunx vitest run` completo (435 verdes hoy — la meta es ≥435 con las reescrituras) + `tsgo`.

---

### Caso de aceptación real

Trámite nuevo con **conflicto de cuantía Y poder multi-candidato**:
1. `heavyWork` termina en `status:"completed"` con `url_minuta_generada` poblado. Sin `requiere_revision_manual`.
2. El `.docx` abre en el visor con: apoderado en blanco (`___________`), cláusula de pago **neutral**, sin la frase "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA", sin la palabra "NO_LEGIBLE" en ningún lado.
3. La UI muestra 2 alertas prioritarias + las importantes que haya.
4. El botón principal dice **"Acciones pendientes (2)"**. Al pulsarlo despliega el listado con las 2 decisiones, cada una con su instrucción y su salto al lugar donde se resuelve. `activity_logs` recibe `ACCIONES_PENDIENTES_MOSTRADAS`. No genera ni descarga.
5. Se elige el candidato y se escribe el monto → autoguardado (solo persiste) → el botón pasa solo a **"Generar documentos"** → clic → **"Cargando…"** → regen sin cobro → **"Descargar"** → descarga exitosa, con `DESCARGADO_CON_ALERTAS` si quedan importantes.
6. **Recargar la página** → el botón vuelve a **"Generar documentos"** aunque el documento exista; pulsar generar → "Cargando…" → "Descargar". Esto verifica la regla de oro: "Descargar se gana en la sesión, nunca se asume".

Un trámite legacy en `requiere_revision_manual` debe abrir sin romper y pasar a `completed` tras el primer regen.


---

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| **Bajar `*_menciones_incoherentes` y `*_divergencia_lecturas` de bloqueante a importante** deja pasar transposiciones de dígitos que hoy se frenan. Es el riesgo mayor del rediseño. | Decisión de producto explícita en la tabla 1.1, requiere aprobación firmada. La detección no se toca; la alerta es visible y se registra en `activity_logs`. |
| Un `.docx` incompleto se descarga en la ventana entre despliegue de backend y frontend. | Fase 1 sale atómica (backend + gate de descarga en el mismo deploy). Regla de secuencia explícita en el orden de implementación. |
| Blanking que sí muta `data_final` y borra datos del usuario. | Copia por rama; test de identidad estructural; `applyPendingDecisionBlanks` se llama solo dentro de `generateAndUploadCancelacionDocs`, nunca en el camino de persistencia. |
| `classifyApoderado` con nombre/cédula vacíos imprime `undefined` o prosa rota. | Test de prosa vacía sobre `renderComparecencia`/`renderAntefirma`; snapshot. |
| Alertas importantes que nunca se apagan → fatiga de alerta y ruido acumulado. | Aceptado explícitamente por producto: son notas de verificación, no bloqueos. "Marcar como verificada" queda para Fase 2. |
| Quitar el regen del autosave: el usuario edita, no pulsa generar y descarga un doc viejo. | Imposible por diseño: recargar siempre reinicia el botón a "Generar"; `isDirty` o `docActualizado=false` fuerzan el estado "Generar" durante la sesión; "Descargar" solo aparece tras generar en la sesión actual. |

| Botones huérfanos de `confirm_manual_review` en el frontend. | Los 3 call sites (717, 1067, 1607) se eliminan en el mismo commit que el bloque del backend. |
| Regen empieza a cobrar créditos por algún camino nuevo. | Verificado hoy: `consume_credit_v2` solo se invoca en el modo normal. Se añade una aserción de grep en la checklist de revisión, no un test. |

## Restricciones respetadas

No se tocan: pipeline de extracción, las 7 capas anti-alucinación, `detectarConflictoCuantia`, `validate.ts`, sistema de créditos, RLS, plantillas `.docx`. Código compartido nuevo en `_shared/isomorphic/`, consumido con el alias `@shared/*`. Cero migraciones SQL.

---

## Alineación con el diseño de referencia (Figma Lantus.AI)

### 1. Componentes de Fase 1 nacen reutilizables para Fase 2

`AccionesPendientesList` y el aviso de sección del Poder se diseñan como componentes autocontenidos que consumen `Alerta[]` de `computeAlertas`, sin acoplarse al popover ni a la página. En Fase 2 se montarán dentro del panel lateral "Alertas Pendientes" del diseño de referencia (Figma node 807-641: panel derecho con encabezado, divisor, pestañas por categoría y tarjetas de alerta con título + descripción). La estructura de datos de cada tarjeta (label corto + descripción + categoría + sección + acción de salto) debe calzar con ese layout desde ya; el componente no debe asumir que vive en un popover.

### 2. Estilos en Fase 1

Se usan los tokens semánticos del design system Sertuss actual: `accent` para atención/verificación, `destructive` para errores, `primary` para acciones principales. No se inventa paleta nueva. El Figma es referencia de **distribución y jerarquía**, no de estilos finales; los estilos se pulen en Fase 2.

### 3. Botón de estados — pauta visual del dueño

Fase 1 (simple):
- "Generar documentos" → primario claro (`default` de `Button`).
- "Cargando…" → gris deshabilitado con spinner.
- "Descargar" → primario claro.
- "Acciones pendientes (N)" → variante de atención (`variant="accent"` o clase equivalente) diferenciada.

Es el mismo componente físico, en la misma posición, que solo cambia texto, estilo y comportamiento según `deriveEstadoBotonMinuta`.

### 4. Fase 2 importará el diseño real desde Figma

Cuando llegue el ciclo de Fase 2, las especificaciones exactas (espaciados, tipografía del panel, layout de dos paneles previsualización + formulario) se extraerán del archivo Figma vía su contexto de diseño. No se improvisarán. Esta nota queda como requisito de entrada de Fase 2.


## FASE 2 — Interfaz (ciclo Plan→Build aparte)

Alcance, sin diseñar aquí: panel lateral único de alertas con 3 pestañas y contador persistente; badge de estado unificado (sin resucitar el bug C8 de mensajes contradictorios entre "Revisión manual pendiente" y el chip "Guardado"); redistribución con textos secundarios movidos a tooltips (referencia Figma Lantus.AI sobre los estilos del design system Sertuss actual); pulido visual del botón de estados y de su listado de acciones pendientes, y del aviso de sección del poder; posible "marcar alerta importante como verificada". Las alertas localizadas en campos se mantienen como están.
