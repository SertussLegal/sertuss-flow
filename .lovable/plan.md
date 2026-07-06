# Investigación: bundling error al redesplegar `procesar-cancelacion`

Evidencia observada, no suposiciones. Cero cambios.

---

## 1. Versión actualmente en producción de `procesar-cancelacion`

**No pude determinar el commit exacto ni el timestamp de deploy** — los logs analíticos de edge functions tienen una ventana efectiva vacía (solo 3 filas retenidas, todas de `mcp` en un rango de ~4ms, sin registros de `procesar-cancelacion` ni deployment history consultable). El endpoint `edge_function_logs` para esta función devuelve "No logs found".

**Evidencia indirecta de que la versión desplegada SÍ funciona hoy**: consulté `cancelaciones` y hay una cancelación `status=completed` con `updated_at=2026-07-06 11:41:11 UTC` (creada hoy 00:20, completada hoy 11:41). Eso solo puede ocurrir si `procesar-cancelacion` respondió 200 en producción hoy mismo. Otras 3 cancelaciones completadas en junio (2026-06-08, 2026-06-21, 2026-06-24) confirman flujo estable.

**Conclusión firme**: La versión en producción funciona. La versión "vigente" es la última que se autodeplegó exitosamente antes de que el pipeline de deploy manual empezara a rechazar el bundle. No puedo poner un commit exacto sin acceso a la historia de deploys.

---

## 2. ¿Cuándo empezó a romperse el deploy?

**No verificable con la telemetría disponible.** Sin historial de deploys ni git accesible, no puedo probar si hubo deploys exitosos de `procesar-cancelacion` posteriores a la consolidación del clasificador.

**Hipótesis con soporte, no certeza**: el re-export `export * from "../../../src/shared/apoderadoClassifier.ts"` **sale de la raíz `supabase/functions/`**. Es plausible que el pipeline auto-deploy de Lovable (que corre en cada mensaje del agente) monte TODO el repo en el sandbox y por eso resuelva el path, mientras que la herramienta explícita `deploy_edge_functions` solo monta `supabase/functions/`. Si eso es cierto, los auto-deploys posteriores a la consolidación pudieron subir la función sin problemas, y solo hoy — al invocar deploy explícito — se destapó la incompatibilidad.

**Lo que sí es certeza**: el bundler falla porque busca `file:///tmp/.../source/src/shared/apoderadoClassifier.ts` y ese archivo no está en el sandbox. La ruta que se le pide bucear existe en el repo (`src/shared/apoderadoClassifier.ts` está ahí, la verifiqué).

---

## 3. Radio de impacto — funciones que dependen de re-exports cross-src

**Grep de imports concretos:**

- **`procesar-cancelacion/index.ts`** — importa dos módulos afectados:
  - `../_shared/apoderadoClassifier.ts` → re-exporta de `../../../src/shared/apoderadoClassifier.ts`
  - `../_shared/prosaBancos/index.ts` → re-exporta de `../../../../src/shared/prosaBancos/index.ts`
- **`adaptar-estilo-prosa/index.ts`** — importa uno:
  - `../_shared/prosaBancos/index.ts` → mismo re-export cross-src

**Re-exports cross-src existentes** (4 archivos, todos vulnerables):

```text
supabase/functions/_shared/apoderadoClassifier.ts        → src/shared/apoderadoClassifier.ts
supabase/functions/_shared/prosaBancos/index.ts          → src/shared/prosaBancos/index.ts
supabase/functions/_shared/prosaBancos/davivienda.ts     → src/shared/prosaBancos/davivienda.ts
supabase/functions/_shared/prosaBancos/types.ts          → src/shared/prosaBancos/types.ts
```

**Funciones NO afectadas** (no importan nada que re-exporte de `src/`): `process-expediente`, `scan-document`, `validar-con-claude`, `mcp`, `audit-refs-davivienda`, y todas las demás.

**Conclusión firme**: solo **2 funciones** están bloqueadas para redeploy manual — `procesar-cancelacion` y `adaptar-estilo-prosa`. `process-expediente`, `scan-document`, `validar-con-claude` NO se ven afectadas.

---

## 4. ¿Por qué técnicamente falla?

El bundler de la herramienta `deploy_edge_functions` monta un sandbox `/tmp/user_fn_.../source/` y coloca solo el árbol `supabase/functions/` dentro. Cuando Deno resuelve el import relativo `../../../src/shared/apoderadoClassifier.ts` desde `supabase/functions/_shared/apoderadoClassifier.ts`, la ruta calculada apunta a `/tmp/.../source/src/shared/apoderadoClassifier.ts` — que no existe en el sandbox porque `src/` no fue copiado.

**Naturaleza del problema**: **restricción del sandbox del deploy tool**, no restricción intrínseca de Deno ni de edge functions. Deno puede importar rutas relativas sin problema; lo que falta es que `src/shared/` sea visible durante el bundle. Alternativas conceptuales para el fix (no ejecutar ahora):
- **A**: mover la fuente de vuelta a `supabase/functions/_shared/` y hacer que `src/shared/` re-exporte de allí (invertir la dirección del re-export). Frontend seguiría importando `src/shared/…` con la misma API. Es transparente para el cliente Vite (Vite sí puede subir un nivel fuera de `src/`).
- **B**: usar un `import_map.json` por función que remapee a una copia interna, con un paso de sincronización.
- **C**: duplicar el código (rechazado explícitamente en la consolidación anterior por drift).

No hay evidencia de que `deno.json` o `import_map.json` actuales cambien este comportamiento — no existen archivos de config específicos que expandan el sandbox.

---

## 5. ¿La versión en producción sirve a clientes reales AHORA?

**Sí, con alta confianza.** Evidencia:

- Cancelación completada hoy 2026-07-06 a las 11:41 UTC (ID `290fd66a…`, `status=completed`).
- Cancelaciones anteriores completadas en junio (3 casos entre 2026-06-08 y 2026-06-24).
- Ninguna telemetría de errores 5xx recientes accesible (retención analítica vacía), pero el hecho de que las cancelaciones progresen a `completed` implica respuestas 200 de la edge function.

**Limitación**: no puedo enumerar todas las invocaciones fallidas recientes porque los logs no están retenidos.

---

## 6. Cronología reconstruida (con lo que hay)

```text
[fecha desconocida]  Consolidación del clasificador: nace `src/shared/apoderadoClassifier.ts`
                     como fuente única; `supabase/functions/_shared/apoderadoClassifier.ts`
                     pasa a re-exportar de esa fuente. Idem prosaBancos (3 archivos).
                     A partir de aquí, el bundle depende de que el pipeline suba `src/`.

[fecha desconocida]  Último auto-deploy exitoso de `procesar-cancelacion`. Este binario
                     es el que hoy sirve producción. Hipótesis: el auto-deploy de Lovable
                     incluye todo el repo, por eso pasó.

2026-06-08           Cancelación completada en prod → función respondiendo 200.
2026-06-21           Cancelación completada en prod → función respondiendo 200.
2026-06-24           Cancelación completada en prod → función respondiendo 200.
2026-07-06 00:20     Cancelación creada en prod.
2026-07-06 11:41     Esa misma cancelación completada → función respondiendo 200 hoy.

2026-07-06 16:08     Cambio de comentarios aplicado en repo (esta sesión).
2026-07-06 16:08     Intento de redeploy manual vía `deploy_edge_functions` →
                     FALLA con "Module not found src/shared/apoderadoClassifier.ts".
                     Esta es la primera evidencia observable de la incompatibilidad
                     entre el re-export cross-src y el sandbox de deploy manual.
```

---

## Resumen ejecutivo

- ✅ Producción está sana; clientes reales cerraron cancelaciones hoy.
- ⚠️ Solo `procesar-cancelacion` y `adaptar-estilo-prosa` quedan bloqueadas para redeploy manual mientras exista el patrón re-export cross-src.
- ✅ `process-expediente`, `scan-document`, `validar-con-claude` NO están afectadas.
- ❓ No pude datar cuándo se rompió el deploy manual, pero es certeza que existió desde que se creó el re-export; los deploys posteriores probablemente pasaron por el auto-deploy que monta el repo completo.
- 🎯 El problema NO es de Deno: es del sandbox del tool. Se resuelve invirtiendo la dirección de los re-exports (fuente en `supabase/functions/_shared/`, re-export desde `src/shared/`) o via import maps — sin duplicar código.

**No aplicar ningún fix todavía**: esta plan es solo el diagnóstico solicitado. La priorización del fix (opciones A/B) queda para tu decisión.
