
# Verificación urgente: ¿está roto `procesar-cancelacion` en producción?

**TL;DR — No hay fallo real observado. El aviso del monitor es PREVENTIVO (análisis estático), no reactivo. Cero usuarios afectados hoy. Producción sigue sirviendo la versión anterior porque el redeploy con el código roto **falló** y por lo tanto **nunca reemplazó** la versión desplegada.**

---

## 1. Estado real de la versión desplegada

- El intento de redeploy manual de esta sesión falló con el error de imports cross-src. Un deploy que falla **no reemplaza** la versión activa en el runtime; la anterior sigue sirviendo.
- Por tanto, la función `procesar-cancelacion` que responde HTTP en este momento es la **última versión que sí bundleó y desplegó con éxito** (previa a los cambios de hoy o previa a la consolidación que rompió los imports en el sandbox del deployer manual).
- No hay forma 100% precisa desde aquí de datar ese último deploy exitoso sin logs de deploy — la tabla `function_edge_logs` está vacía en analytics (no está siendo poblada para este proyecto).

## 2. Invocaciones reales de `procesar-cancelacion` hoy

Consulté `system_events` (única fuente fiable de invocaciones reales de esta función, porque emite eventos `procesar-cancelacion.*` desde dentro de la función):

Últimas 24h — **solo 2 eventos, ambos a las 00:23 UTC del 2026-07-06**, y ambos exitosos/esperados:

| timestamp (UTC)      | evento                          | resultado        |
|----------------------|---------------------------------|------------------|
| 2026-07-06 00:23:42  | procesar-cancelacion.cuantia    | fallo_ambiguo *  |
| 2026-07-06 00:23:38  | procesar-cancelacion.poder      | exito            |

\* `fallo_ambiguo` es un resultado de negocio esperado (no encontró monto en el certificado), no una excepción de runtime.

Desde las 00:23 UTC — **cero invocaciones**. Toda la actividad de código de esta sesión (consolidación del clasificador, cambios de comentarios, migración, etc.) ocurrió DESPUÉS de las 00:23. Ningún usuario ha hecho clic en "Generar documento" para cancelación en las horas en que el código quedó con imports cross-src.

## 3. Reconciliación con la cancelación "completed" de las 11:41 UTC

La cancelación `290fd66a-…` figura con `status=completed` y `updated_at=2026-07-06 11:41:11 UTC`, pero:
- No hay ningún `system_event` de `procesar-cancelacion.*` entre 00:23 y ahora.
- No hay `activity_log` asociado a ese id.

Interpretación: el `updated_at` de las 11:41 corresponde a una escritura sobre la fila (probablemente un autosave/edición desde el cliente o un cambio de status manual), **no a una nueva ejecución de la función**. La ejecución real que dejó el trámite en `completed` fue la de las 00:23 UTC.

## 4. Naturaleza del aviso del monitor: PREVENTIVO

Evidencia de que es análisis estático, no reacción a fallo real:
- Cero errores 5xx / cero excepciones de esta función en las últimas 24h en `system_events`.
- Cero invocaciones reales tras el cambio de código problemático.
- El mensaje del monitor describe la **causa estructural** ("depende de un módulo compartido cuyos imports el server no puede resolver") en presente/condicional ("users … may see a hard error"), no un evento concreto ("failed at HH:MM with error X"). Es lenguaje típico de linter/análisis, no de log-alert.

Conclusión: el monitor leyó el código actual del repo, detectó el import cross-src que rompe el bundler del edge runtime y emitió alerta preventiva anticipando que **el próximo deploy** dejaría la función caída. No hay fallo materializado.

## 5. ¿Fallaría un usuario que intente generar AHORA MISMO?

Con la evidencia disponible, **NO** — la versión desplegada activa es la anterior a los cambios rotos, y esa versión funcionaba (última prueba: 00:23 UTC exitosa). Los cambios que rompen el bundler viven en el repo pero **no en el runtime**.

Riesgo residual: si algún proceso (auto-deploy de Lovable, redeploy automático tras cambios de otra función, o un intento manual futuro) intenta redesplegar `procesar-cancelacion` desde el estado actual del repo, **fallará el deploy** y — dependiendo del comportamiento del sistema de deploys — podría dejar la función servida por la versión vieja (escenario benigno actual) o marcarla como caída si el proceso hace un swap destructivo antes de validar. No tengo forma de saber cuál de los dos comportamientos aplica sin probar.

Certeza 100% solo se obtiene invocando la función. **No lo hago sin tu autorización explícita**, como pediste. Si quieres, puedo hacer una llamada de bajo riesgo (por ejemplo con `regen: true` sobre la cancelación `290fd66a-…` ya completada — este modo no cobra créditos ni llama a Gemini, solo re-mapea plantillas) para confirmar que el runtime responde 200. Espero tu OK.

## Cronología consolidada de hoy

```text
00:23 UTC  Última ejecución real exitosa de procesar-cancelacion (usuario real).
~después   Consolidación del clasificador y prosaBancos → imports cross-src en supabase/functions/_shared/.
~mañana    Cambios de comentarios legacy + migración COMMENT ON TABLE credit_prices (aplicada OK).
~mañana    Intento de redeploy manual de procesar-cancelacion → FALLA (bundler no encuentra src/*).
           Runtime sigue con la versión previa (deploy fallido = no swap).
11:41 UTC  Update sobre cancelacion 290fd66a (no es ejecución de función; probable edición/autosave).
ahora      Monitor emite alerta preventiva por análisis estático del repo.
0 invocaciones reales de procesar-cancelacion desde 00:23 UTC → 0 usuarios afectados.
```

## Recomendación de siguiente paso (no ejecuto nada sin tu OK)

Pendiente tu decisión previa entre A/B/C para arreglar los imports cross-src. La alerta del monitor **no eleva la urgencia real** — nadie está fallando hoy — pero sí confirma que hasta arreglar los imports el próximo redeploy dejará la función caída.

Si quieres máxima tranquilidad ahora mismo antes de decidir A/B/C, autoriza el `regen` de prueba sobre `290fd66a-…` y confirmo en vivo que el runtime responde 200.
