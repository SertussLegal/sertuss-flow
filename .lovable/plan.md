## Contexto y hallazgos frescos

Confirmé leyendo el código (no confiando en reportes previos):

- **`POWER_V6_EXTRACTOR_ENABLED`** (edge): OFF por default. En `procesar-cancelacion/index.ts:1973-1978` y `:2341-2372` corre dentro de `try/catch` — si el flag está ON y v6 falla, se loguea el error y `deepV6 = null`. El merge (`mergePoderBancoV6`) recibe `deepV6=null` y el resultado degrada al camino legacy sin romper. **Fallback seguro confirmado.**
- **`POWER_DEEP_SCHEMA_ENABLED`** (alias V5, edge): OFF por default. Controla (a) caché `ocr_raw_cache` inmutable, (b) `selectMinutaTemplate` — solo devuelve plantilla v3 si el flag está ON *y* existe en el bucket; si no, cae a v2 (`index.ts:67`).
- **`VITE_POWER_DEEP_UI_ENABLED`** (cliente): ON por default. En `src/pages/CancelacionValidar.tsx:1214` gatea `<ProsaApoderadoPreviewCard>`, que consume `data.partes.banco_nit` + prosa Davivienda — **no depende de bloques v6 profundos**. El componente ya funciona con el schema plano legacy. La "desalineación" que anoté en `.lovable/plan.md` es menos grave de lo que parecía: la UI no requiere V6 para renderizar.
- **Estado actual en prod:** `V6_EXTRACTOR=OFF`, `DEEP_SCHEMA=OFF`, `UI=ON`. El extractor semántico de cuantía (`extractCuantiaDedicada`, líneas 2092 y 2421) **no está gateado por ningún flag** y ya corre en el camino real de usuarios.

---

## Recomendación por punto

### 1. Activar `POWER_V6_EXTRACTOR_ENABLED=true` (edge secret)

**Recomendación: SÍ, activar antes de la prueba de Alejandra.**

Justificación:
- Fallback probado en código (try/catch → `deepV6=null` → merge legacy).
- Tests verdes (115/115) incluyen `poderBancoExtractor.test.ts` y `apoderadoClassifier.test.ts`.
- Populates `data_ia.poder_banco.apoderado.tipo` (natural vs jurídica) — mejor auditabilidad sin afectar salida docx.
- Los bloques profundos v6 (`poderdante`, `instrumento_poder`, `facultades`) se copian tal cual en `data_final` (línea 2010), no rompen nada porque la UI no los edita todavía.

Riesgo: costo extra de una llamada Gemini por poder (v6 corre **además** del dedicado plano, no en su lugar). Aceptable para validar el schema profundo con tráfico real.

### 2. `POWER_DEEP_SCHEMA_ENABLED` (V5)

**Recomendación: NO activar todavía. Dejar para después de la prueba de Alejandra.**

Trade-offs:

| Activar ahora | Dejar OFF |
|---|---|
| ✅ Caché `ocr_raw_cache` ahorra costos en re-procesos | ✅ Cero cambio en la ruta caliente que Alejandra probará |
| ✅ Selector de plantilla v3 (si existe en bucket) | ⚠️ Si no hay `template_v3.docx` en `cancelaciones-plantillas`, cae a v2 sin ruido — pero cambio no verificado |
| ⚠️ Doble variable en el experimento de Alejandra | ✅ Aísla la prueba a V6 puro |
| ⚠️ Caché inmutable puede mostrar payloads viejos si el prompt cambió sin bump de versión | |

**Preferencia:** una variable a la vez. V6 aporta valor observable (schema profundo en `data_ia`); V5 es optimización de infra que no cambia lo que Alejandra ve. Activar V5 en un segundo pase, tras 24-48h de V6 estable.

### 3. Corregir desalineación de flags

Con la decisión (V6=ON, V5=OFF, UI=ON):

- **UI (`VITE_POWER_DEEP_UI_ENABLED=ON`)**: mantener. Verifiqué que `ProsaApoderadoPreviewCard` no requiere bloques v6 profundos — usa `buildProsaContext(pb, ne)` sobre el schema plano. Ya funciona en prod.
- **No hay que apagar la UI.** La "desalineación" documentada era pesimista; el componente degrada bien.
- **Acción concreta única:** actualizar el comentario en `.lovable/plan.md` y en `poderBancoSchemaVersion.ts` para reflejar que UI no depende de v6.

### 4. Plan de verificación pre-Alejandra

Antes de que Alejandra toque el sistema, ejecutar en este orden:

1. **Deploy con `V6=true`** y confirmar boot en logs (`edge_function_logs`).
2. **Smoke test con `curl_edge_functions`** contra un `cancelacionId` de staging propio (no de cliente), acción `reprocess_poder`. Verificar en respuesta:
   - `resultado ∈ {exito, parcial}`
   - `data_ia.poder_banco.apoderado.tipo` presente (evidencia de que v6 corrió)
   - Sin errores `[v6 extractor failed]` en logs.
3. **Regresión sobre los 3 casos históricos** (`4b05d210`, `290fd66a`, `2bef1db3`) vía `_regression_cuantia.ts` (solo-lectura, no persiste): confirmar `resultado_derivado` idéntico al reporte anterior (éxito + 2 indeterminada_confirmada).
4. **Ejecutar `bunx vitest run`** — debe seguir 115/115.
5. **`security--run_security_scan`** — no debe introducir findings nuevos (V6 no toca RLS ni secrets).
6. **Prueba end-to-end manual** con una cancelación de prueba (owner sertuss): subir Poder Davivienda real, validar que la UI de "Prosa apoderado" renderiza sin errores y que el docx generado no perdió campos vs. la versión pre-V6.

Solo si los 6 pasos pasan → invitar a Alejandra.

### 5. Plan de rollback

**Trigger:** cualquiera de: (a) Alejandra reporta error visible, (b) tasa de `[v6 extractor failed]` en logs > 10%, (c) discrepancia en `data_ia.poder_banco` vs. lo que muestra la UI, (d) aumento de costo Gemini inaceptable.

**Rollback en 1 paso (30 segundos):**
1. En Project Settings → Secrets: cambiar `POWER_V6_EXTRACTOR_ENABLED` de `true` a `false` (o eliminar el secret; default es OFF).
2. Redesplegar `procesar-cancelacion` (`supabase--deploy_edge_functions`).
3. Verificar en logs que el próximo boot lee `POWER_V6_EXTRACTOR_ENABLED=false`.

**No requiere revertir código.** Los flags son runtime, el fallback es automático. Los datos ya persistidos en `data_ia.poder_banco.apoderado.*` con V6 quedan como huérfanos benignos — la UI no los consume, no rompen nada.

**Comunicación:** avisar a Alejandra en cuanto se dispare el rollback y anotar en `.lovable/plan.md` el motivo + timestamp.

---

## Resumen ejecutivo

| Punto | Decisión |
|---|---|
| V6 extractor edge | **Activar** (`POWER_V6_EXTRACTOR_ENABLED=true`) |
| V5 deep schema edge | **Dejar OFF** hasta ver resultado con Alejandra |
| UI flag cliente | **Mantener ON** — no requiere v6 |
| Pre-Alejandra | 6 pasos de verificación (boot, smoke, regresión, tests, scan, e2e manual) |
| Rollback | Toggle 1 secret + redeploy, sin cambios de código |

## Pasos de ejecución (para aprobar antes de correr)

1. `secrets--set_secret` → `POWER_V6_EXTRACTOR_ENABLED=true`.
2. `supabase--deploy_edge_functions` → `["procesar-cancelacion"]`.
3. `supabase--edge_function_logs` → confirmar boot.
4. `supabase--curl_edge_functions` → smoke test contra caso propio.
5. Correr `_regression_cuantia.ts` contra los 3 IDs (solo-lectura).
6. `bunx vitest run`.
7. `security--run_security_scan`.
8. Actualizar `.lovable/plan.md` con resultado.
9. Dar luz verde para Alejandra.

**Nada de esto se ejecuta sin tu OK explícito.**
