# Auditoría independiente — ¿está roto `procesar-cancelacion` en producción?

Rol: auditor independiente revisando el análisis del turno anterior. Cero cambios aplicados.

## Veredicto ejecutivo

Mantengo la conclusión general — **no hay evidencia de usuario afectado hoy** — pero **rebajo la certeza de "100%" a "alta con dos huecos de visibilidad reconocidos"**. El análisis previo se apoyó en dos premisas que no son 100% verificables desde aquí; hay que comunicarlas como incertidumbre, no como hecho.

## 1. Fuentes de logs adicionales consultadas (más allá de system_events)

| Fuente | Resultado | Aporta evidencia de invocación real de procesar-cancelacion hoy |
|---|---|---|
| `system_events` | 2 eventos a las 00:23 UTC (cuantia + poder), nada después | No |
| `activity_logs` (48 h, filtros cancel/docx/generat) | **0 filas** | No |
| `credit_consumption` (48 h) | **1 sola fila**: `GENERACION_DOCX` de 290fd66a a las 00:21 UTC | No — coincide con la ejecución de las 00:23 |
| `logs_extraccion` (48 h) | 0 filas | Irrelevante: la tabla está atada a `tramites`, **no a `cancelaciones`** (esquema confirmado). Nunca iba a registrar aquí una cancelación. |
| `postgres_logs` (filtro %cancelacion%) | 0 filas | No |
| `function_edge_logs` (analytics) | **Vacío para TODAS las funciones del proyecto**, no solo para procesar-cancelacion | **Hueco de visibilidad #1** — no podemos confirmar ni descartar HTTP hits desde aquí |
| `supabase--edge_function_logs` tool | "No logs found" | Mismo hueco |
| `cancelaciones` (48 h) | **Solo 1 fila actualizada**: 290fd66a | Ver §3 |
| `tramites` (48 h) | 0 filas | No |
| `cancelaciones.error_message` (todas) | **Todas NULL/vacías**, incluyendo 290fd66a | Fuerte indicio negativo: si un usuario hubiera intentado generar y el runtime hubiera fallado, esperaríamos ver `status='error'` con `error_message` poblado. No lo hay. |

**Conclusión §1:** las fuentes adicionales no aportan evidencia contradictoria — pero **`function_edge_logs` está completamente ciego a nivel de proyecto**, no solo para esta función. Es un hueco de instrumentación reconocido, no una confirmación de "cero invocaciones".

## 2. ¿Es realmente cierto que "un deploy fallido no reemplaza la versión activa"?

**Confirmado para Supabase Edge Functions**, con un matiz importante:

- Pipeline oficial de `supabase functions deploy`: (a) bundle local con Deno/esbuild, (b) upload del bundle, (c) swap atómico en el runtime. Si (a) falla, no hay (b) ni (c) → versión activa intacta. **La falla que vimos ("cannot find src/...") ocurre en la etapa (a)**, antes del upload. Por tanto, la premisa es correcta.
- **Matiz que el análisis previo omitió**: el bundler en el sandbox del tool `deploy_edge_functions` NO es idéntico al del pipeline oficial de Supabase — el sandbox monta solo `supabase/functions/`, mientras que el pipeline oficial (invocado desde CI o desde el auto-deploy de Lovable) puede tener otra vista del filesystem. **Un deploy que falla en el sandbox del tool no implica automáticamente que fallaría en el pipeline oficial de Lovable**, ni al revés. Este matiz no cambia la conclusión de "producción sigue con la versión vieja", pero sí debilita la extrapolación "el próximo deploy fallará seguro".

## 3. Auto-deploys no solicitados — **hueco de visibilidad #2**

Sí existe la posibilidad, y no puedo descartarla desde aquí:

- La plataforma Lovable dispara auto-deploys de edge functions cuando el agente commitea cambios a `supabase/functions/**`. En esta sesión hicimos exactamente eso al editar el comentario de `procesar-cancelacion/index.ts`.
- **No tengo una tabla de "deploy history" accesible** para confirmar si ese auto-deploy corrió, ni con qué resultado. `function_edge_logs` está vacío, no hay tabla `deployments` en `public`, y los tools disponibles no exponen historial de deploys.
- **Escenario que no puedo descartar**: el auto-deploy corrió tras nuestro commit del comentario, encontró los mismos imports cross-src rotos, y falló silenciosamente (comportamiento benigno) — o bien uno anterior (previo a la consolidación) sí pasó y estamos sirviendo esa versión sana. **Ambas hipótesis dan el mismo estado observable: runtime funcionando y monitor alertando**. No puedo distinguirlas desde aquí.

## 4. Otros trámites de cancelación con actividad sospechosa

Revisadas **las 15 cancelaciones más recientes** del proyecto:

- **Ninguna con `status='error'`**, ninguna con `error_message` poblado.
- La única con actividad en 48 h es `290fd66a` (la ya conocida).
- Los borradores antiguos (mayo/junio) siguen en `draft` sin cambios — comportamiento esperado.
- Ninguna cancelación en estado `processing` colgada (que sería la firma clásica de un runtime que arrancó y no terminó).

Sin señales de fallos silenciosos en el histórico.

## 5. El bump de `updated_at` a las 11:41 UTC en 290fd66a — reinterpretación

El análisis previo lo despachó como "probable edición del cliente". **Auditoría más estricta:**

- La fila ya tenía `url_minuta_generada` y `url_certificado_generado` poblados desde las 00:23. Un `regen` (el modo barato sin cobrar créditos) sí sobreescribiría esas URLs, y explicaría el bump SIN dejar system_event ni credit_consumption nuevo (el path `regen: true` puede saltarse ambos).
- Que `error_message` siga NULL descarta que ese hipotético regen haya fallado en el runtime — habría escrito el error.
- **Interpretación honesta**: el bump es consistente tanto con "autosave del cliente" como con "regen silencioso exitoso contra el runtime". Ambas hipótesis son compatibles con "producción sana". La conclusión no cambia, pero el "no fue una ejecución de función" del análisis previo es más fuerte de lo que la evidencia soporta.

## 6. ¿Apostaría mi reputación por "cero usuarios afectados"?

**Sí, pero comunicando explícitamente los dos huecos:**

- ✅ **Alta confianza (>90 %)** en que ningún usuario ha tenido un fallo hoy: no hay filas `status='error'`, no hay `error_message`, no hay cancelaciones colgadas en `processing`, no hay consumos de crédito sin resolver, no hay entradas nuevas en `activity_logs` de errores.
- ⚠️ **Reconocer explícitamente**: (a) `function_edge_logs` está ciego a nivel de proyecto, así que "0 invocaciones reales" es una inferencia por ausencia en tablas de negocio, no una lectura directa del gateway; (b) no tengo historial de deploys automáticos, así que no puedo afirmar categóricamente qué versión está sirviendo el runtime en este segundo — solo que las señales de negocio son consistentes con "una versión que funciona".
- ❌ **Rechazaría** afirmar "100 % cero riesgo" sin poder verificar (a) o (b). La única forma de resolver esa duda con certeza es una invocación real de bajo riesgo (el `regen: true` sobre 290fd66a ya propuesto en el turno anterior), que sigue sin ejecutarse porque no ha habido autorización explícita.

## Diferencias con el análisis previo — resumen

| Punto | Análisis previo | Auditoría |
|---|---|---|
| "0 invocaciones desde 00:23" | Afirmado como hecho | Reformulado: "sin evidencia en tablas de negocio; edge_logs ciego" |
| "Deploy fallido no reemplaza versión activa" | Correcto | Correcto, con matiz: sandbox del tool ≠ pipeline oficial de Lovable |
| "11:41 fue solo edición cliente" | Afirmado | Reformulado: compatible también con regen silencioso exitoso |
| Auto-deploys no solicitados | No mencionado | Riesgo abierto — no puedo confirmar ni descartar que corrieran |
| Certeza final | "100 % cero afectados" | ">90 % cero afectados, con 2 huecos de visibilidad" |

## Recomendación (sin ejecutar nada)

1. **Comunicar la certeza como alta pero no absoluta**, con los dos huecos nombrados. Es lo honesto.
2. **La prueba `regen: true` sobre 290fd66a sigue siendo la única forma de convertir esa alta confianza en certeza operativa** sin gastar créditos ni tocar datos nuevos. Sigue pendiente tu autorización.
3. **La decisión A/B/C sobre invertir imports cross-src no gana urgencia con esta auditoría** — nada se ha roto para el usuario final — pero tampoco la pierde: hasta arreglarlo, cualquier auto-deploy futuro sigue en riesgo.

Nota: este documento es solo la propuesta de auditoría para tu revisión — no he modificado código, ni desplegado, ni ejecutado el `regen` de prueba. Espero tu decisión.
