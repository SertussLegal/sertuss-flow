# Salida del callejón sin salida de cuantía en conflicto

Caso real: trámite `e07c5d5a-c1a4-4200-be39-e04dbc38f8d0`. El hard-block `cuantia_conflicto_candidatos_no_resuelto` es correcto, pero la usuaria no lo veía ni tenía forma de resolverlo. El plan no toca la lógica del hard-block ni `MANUAL_OVERRIDE_RULES`: solo hace visible el bloqueo, expone la evidencia y da las dos salidas legítimas (elegir un monto, o confirmar indeterminada) que el servidor ya acepta.

## A. Persistir los candidatos en el trámite

Hoy los `candidatos_vistos` solo viajan a `system_events` (telemetría), así que la UI no puede mostrarlos.

- `supabase/functions/procesar-cancelacion/index.ts`, en el bloque de conflicto de `heavyWork` (donde ya se estampan `cuantia_origen` y el warning): además escribir en `hipoteca_anterior.cuantia_candidatos` un arreglo de `{ monto, texto_fragmento, pagina_aprox }` con **solo** los candidatos `clasificacion === "cuantia_credito"`, montos no nulos/no cero, deduplicados por monto (se conserva el primer fragmento visto por monto), orden estable descendente por monto.
- La construcción de ese arreglo va en `supabase/functions/_shared/isomorphic/cuantiaConflicto.ts` como función pura nueva `buildCuantiaCandidatosUi(candidatos)` — mismo módulo que ya define la detección, reutilizable por tests del frontend.
- Nunca se borra el campo cuando el humano resuelve: queda como evidencia forense del conflicto (es metadata, no afecta la plantilla ni el docx, y `nullgetter` no la lee).
- Flujo `reprocess_cuantia`: **sí conviene**, pero hoy ese flujo no ejecuta `detectarConflictoCuantia` en absoluto — puede volver a aplicar un monto elegido por el modelo entre candidatos en conflicto. Alcance propuesto (acotado): aplicar la misma detección antes del merge de `reprocess_cuantia`; si hay conflicto, no aplicar monto, estampar `cuantia_origen`, warning y `cuantia_candidatos` igual que en el flujo auto. Si prefieres dejar `reprocess_cuantia` intacto en esta ronda, se puede limitar a persistir `cuantia_candidatos` sin cambiar su lógica de merge — dímelo y ajusto.

## B. Recuadro de resolución bajo el campo de valor

En `src/pages/CancelacionValidar.tsx`, debajo del input "Valor del crédito hipotecario original", cuando `cuantia_origen === "conflicto_candidatos_no_resuelto"` y el campo está vacío:

- Explicación breve: la escritura contiene varias cifras distintas presentadas como valor del crédito; la IA no elige, decide el humano.
- Una tarjeta por candidato con: monto formateado, el fragmento textual literal y la página aproximada. Botón "Usar este monto" que llena `valor_hipoteca_original` con formato notarial (`LETRAS DE PESOS ($NÚMEROS)` vía `numberToWords`/`formatMonedaLegal` ya existentes en `src/lib/legalFormatters.ts`), pone `valor_hipoteca_es_indeterminada: false` y `cuantia_origen: "manual"`.
- Botón secundario "Confirmar como cuantía indeterminada": deja `valor_hipoteca_original: ""`, `valor_hipoteca_es_indeterminada: true`, `hipoteca_garantia_abierta` **sin tocar** y `cuantia_origen: "manual"`. Es el escape que `MANUAL_OVERRIDE_RULES` ya acepta hoy, sin cambiar el servidor.
- Degradación elegante: si no hay `cuantia_candidatos` (trámites históricos, incluido posiblemente `e07c5d5a`), se muestra el mismo recuadro sin tarjetas, con la instrucción de escribir el monto real a mano o confirmar indeterminada con el botón.
- El texto de ayuda actual del campo se corrige: escribir "HIPOTECA DE CUANTÍA INDETERMINADA" dentro del input **no** libera el bloqueo; hay que usar el botón.

## C. Banner sticky completo y tipo del frontend

- En el cálculo de `motivos` del banner "Revisión manual pendiente" (`CancelacionValidar.tsx`, ~línea 1018) agregar `data.hipoteca_anterior._coherencia_warnings`. El label ya existe en `WARNING_LABELS`.
- Ampliar el tipo `Data["hipoteca_anterior"]`: `cuantia_origen?: "escritura" | "certificado" | "manual" | "conflicto_candidatos_no_resuelto"` y `cuantia_candidatos?: Array<{ monto: number; texto_fragmento?: string; pagina_aprox?: number | null }>`, más `_coherencia_warnings?: string[]`.

## D. Test estático de cobertura

Revisado: `src/shared/hardBlockCoverage.test.ts` **ya tiene** la Aserción 7 (`todo *_no_resuelto tiene entrada en MANUAL_OVERRIDE_RULES`), que nombra explícitamente `cuantia_conflicto_candidatos_no_resuelto` y valida su sufijo hard-block. No hace falta aserción nueva; no se toca ese archivo.

## Archivos a tocar

| Archivo | Cambio |
| --- | --- |
| `supabase/functions/_shared/isomorphic/cuantiaConflicto.ts` | `buildCuantiaCandidatosUi` (pura) + tipo del candidato UI |
| `supabase/functions/procesar-cancelacion/index.ts` | Persistir `cuantia_candidatos` en el bloque de conflicto (y en `reprocess_cuantia`, según decisión de alcance) |
| `src/pages/CancelacionValidar.tsx` | Recuadro de resolución, banner sticky con warnings de hipoteca, tipos, texto de ayuda |
| `src/shared/cuantiaConflicto.test.ts` | Casos nuevos de `buildCuantiaCandidatosUi` |

No se tocan: `hardBlockRules.ts`, `validate.ts`, `hardBlockCoverage.test.ts`, plantillas, migraciones (el campo vive dentro del JSON existente, sin cambio de esquema).

## Riesgos

- **Doble camino de escritura del campo**: los botones y el input libre deben producir el mismo shape; se mitiga centralizando el patch en un handler único dentro del componente.
- **Autoguardado**: `cuantia_candidatos` es una clave más dentro de `hipoteca_anterior`; el merge de regeneración es por spread, así que se preserva — se verifica con el test de merge existente.
- **Formato notarial del botón**: si el monto se formatea mal, el humano igual lo puede editar; el campo sigue siendo libre y `cuantia_origen` ya quedó en "manual".
- **`hipoteca_garantia_abierta`**: el botón de indeterminada no lo modifica, para no alterar el hecho Ley 546/VIS que se registró aparte.
- **Confusión de "manual"**: `cuantia_origen: "manual"` significa "el humano decidió", no "el monto es correcto". Queda documentado en el código.

## Verificación

1. `bunx vitest run` completo (suite actual verde, más los casos nuevos de `buildCuantiaCandidatosUi`: dedupe por monto, filtrado de clasificación, montos null/0, arreglo vacío).
2. `npx tsgo --noEmit`.
3. Caso real `e07c5d5a-c1a4-4200-be39-e04dbc38f8d0` como aceptación: abrir el trámite y confirmar (a) el banner sticky ahora lista el motivo de cuantía; (b) aparece el recuadro bajo el campo (en modo degradado si el trámite no tiene `cuantia_candidatos`); (c) al pulsar "Confirmar como cuantía indeterminada" y luego "Confirmar revisión manual y generar", el trámite se desbloquea y genera; (d) alternativamente, escribir un monto real también desbloquea.
4. Un trámite nuevo con conflicto (o reproceso controlado) para comprobar que `cuantia_candidatos` se persiste con fragmentos y páginas, y que las tarjetas se renderizan.
5. Revisión de `system_events`: la telemetría de cuantía sigue registrando `conflicto_montos` igual que hoy.
