# Diagnóstico: `validar-con-claude` — ¿Mantener o retirar?

**Restricción respetada:** cero modificaciones. Solo lectura de código + BD.

---

## 1. Prompt enviado a Claude (Sonnet 4)

**Modelo:** `claude-sonnet-4-20250514`, `max_tokens: 4096`, sin streaming.

### System prompt (construido dinámicamente en `construirSystemPrompt`, líneas 270-358)

Estructura fija + 3 bloques inyectados desde BD:

1. **Rol acotado (líneas 290-302):** "Auditor senior de documentos notariales… **ROL ÚNICO: AUDITORÍA. NUNCA REDACCIÓN.** Prohibido reescribir cláusulas o proponer prosa. `valor_sugerido` debe ser dato atómico (cédula, fecha, monto), nunca párrafo. La redacción es responsabilidad de otro sistema (Gemini Pro)."
2. **Contexto de notaría** (desde `configuracion_notaria`): número, círculo, departamento, notario titular.
3. **Plantilla del acto** (desde `plantillas_validacion`): `campos_requeridos` + `relaciones_entre_campos` en JSON.
4. **Reglas activas** (desde `reglas_validacion`, filtradas por `tipo_acto` y `momento`): lista de 35 reglas activas hoy. Muestra: `FMT_CEDULA_DIGITOS`, `FMT_NIT_VERIFICACION`, `FMT_MATRICULA`, `FMT_CHIP`, `COH_LETRAS_NUMERO`, `COH_NOMBRES_CRUZADOS`, `COH_SUMA_CUANTIAS`, `COH_MATRICULA_CIRCULO`, `COH_GENERO_GRAMATICAL`, `COH_CADENA_TRADICION`, `COH_INMUEBLE_ENTRE_DOCS`, `LEG_REDAM`, `LEG_HIPOTECA_ENTIDAD`, `LEG_AFECTACION_VIVIENDA`, `LEG_ANTECEDENTES`, `LEG_PODER_VIGENCIA`, `LEG_RPH_DATOS`, `NEG_AL_MENOS_UN_VENDEDOR/COMPRADOR`, `CTX_TEMPLATE_NOTARIA_INFO`, `CTX_DATOS_FALTANTES_POST_CARGA`, etc.
5. **Formato de respuesta obligatorio (JSON):** `estado` (aprobado / requiere_revision / errores_criticos), `puntuacion` (0-100), array `validaciones[]` con `nivel`, `codigo_regla`, `campo`, `campos_relacionados`, `valor_actual`, `valor_sugerido` (≤80 chars), `explicacion` (≤220 chars), `auto_corregible`, `ui_target` (modal_bloqueante | side_panel_audit | field_inline_badge), `priority` (high | medium | low), y `retroalimentacion_general`.
6. **Reglas UI:** errores multi-campo → modal bloqueante; errores 1-campo → badge inline; coherencia → panel lateral medium; sugerencias → panel lateral low.
7. **Bloque especial notaría:** si detecta datos de notaría en un documento cargado, reportarlos como `sugerencia` auto-corregible bajo `notaria_tramite.<campo>` para que el usuario acepte con un clic.

### User prompt (construirUserPrompt, líneas 360-381)

```
MODO: <"campos" (tab X) | "documento">
TIPO DE ACTO: <compraventa|hipoteca|...>
DATOS EXTRAÍDOS POR OCR: <JSON completo>
CORRECCIONES YA APLICADAS POR EL SISTEMA (NO contradecir): <JSON>
VALIDACIONES YA REALIZADAS POR LA APLICACIÓN (NO repetir): <lista>
[si modo=documento] TEXTO DEL DOCUMENTO GENERADO PARA REVISIÓN: <HTML/texto Gemini>
```

**Salida:** JSON parseado, sanitizado (`sanitizeAiJson`), contrato UI reforzado (`enforceUiContract` trunca `explicacion`/`valor_sugerido` y garantiza `ui_target`/`priority`).

---

## 2. Momento del flujo, obligatoriedad, fallback

**Se invoca en 2 puntos, ambos en `src/pages/Validacion.tsx`:**

| Momento | Modo | Trigger | Efecto |
|---|---|---|---|
| Tras subir un documento en el sidebar (cédula, certificado, predial, escritura, poder) | `campos` (con `tab_origen`) | `validarDespuesDeCarga` (línea 1345) — llamada automática tras `scan-document` | **Silencioso.** Guarda el resultado en `validacionCampos` para pintar badges/panel. Si falla, `try/catch` vacío (`/* silencio total */`, línea 1375). |
| Justo antes de abrir el `PreviewModal` para generar el .docx | `documento` (con `texto_preview` del HTML de Gemini) | Botón "Generar documento" (línea 1963) | **Semi-bloqueante suave:** si Claude marca `errores_criticos` → abre `ValidacionDialog` (el usuario puede ignorarlo). Si `error_sistema`, advertencias, sugerencias o `aprobado` → abre preview directo. |

**Obligatoriedad:** ninguna vía bloquea al usuario. `src/services/validacionClaude.ts:60-66` captura toda excepción y devuelve `{estado: "error_sistema", validaciones: []}`. En la edge, cualquier error 500 devuelve la misma forma. En Validacion.tsx, `error_sistema` cae directamente en el preview sin fricción.

**Costo del trámite:** validar-con-claude NO cobra créditos (no llama `consume_credit_v2`). El costo USD lo absorbe Sertuss. Solo el OCR (1 crédito) y la generación (2 créditos) cobran.

**Autorización:** JWT + verificación de membership + verificación de que `tramite_id` pertenece a la org (líneas 40-89). Correcto.

---

## 3. Solapamiento con Gemini Pro y con validaciones deterministas

### Lo que YA hace `process-expediente` (Gemini 2.5 Pro)
Redacción HTML del documento + sugerencias_ia. Es **generación creativa**, no auditoría. No emite un JSON estructurado de validación por reglas.

### Lo que YA hace la app deterministamente
- `docxCriticalFields.ts` / `cancelacionCriticalFields.ts`: marca campos vacíos críticos en UI (bordes rojos).
- `apoderadoClassifier`, `validatePoderSuficiencia`, `poderVigenciaCliente`: reglas duras sobre poderes.
- `reconcileData` + `normalizeCC`: cruce multi-documento por cédula.
- `legalFormatters` + `genero.ts` + concordancia notarial: formateo TEXTO (NÚMERO).
- Skills: `direccion-completa-saneada-cancelacion`, `cuantia-indeterminada-cancelacion`, `formato-texto-numero-notarial`, etc.

### Lo que hace Claude que nadie más cubre hoy
Auditando el prompt + las 35 reglas activas, **el 100% de las 35 reglas son deterministamente expresables** (regex de CC/NIT, prefijos de matrícula, sumas, cruce de nombres, presencia de campos). Solo 2 categorías tienen valor "AI-hard":

1. **`COH_TEMPLATE_VS_ESCRITURA_PREVIA` / `CTX_TEMPLATE_NOTARIA_INFO`:** detección de datos de notaría embebidos en un PDF cargado. Requiere lectura semántica del OCR — pero **ya la hace `scan-document`** (Gemini Flash con tool calling).
2. **`COH_GENERO_GRAMATICAL`:** inferir género por nombre. Skill dedicada `concordancia-genero-minutas` lo resuelve determinísticamente.

**Conclusión:** solapamiento ≈ 100%. Claude no está descubriendo una clase de problema que ningún otro paso cubra. Su único diferenciador real es "segunda pasada con un modelo distinto sobre el JSON consolidado antes de generar el .docx".

---

## 4. Razón documentada de por qué se agregó Claude

Búsqueda en el código: no hay ADR, `README` de la función, ni comentarios explicando la decisión. Memoria del proyecto tiene 3 entradas relacionadas:

- `mem://tech/infraestructura-validacion-ia` — "Claude API preview, 28 reglas de negocio"
- `mem://features/asistente-auditoria-claude` — "No bloqueante, severidad escalonada, puntuación 0-100"
- `mem://tech/auditoria-ia` — "Comparación data_ia vs data_final en tabla de logs"

**Motivación implícita** (deducida del system prompt): tener un "auditor senior" independiente del redactor (Gemini) para dar una **segunda opinión no-bloqueante** con una puntuación 0-100 visible al usuario. Nunca hubo un problema documentado de "Gemini falla en detectar X".

---

## 5. Uso real en producción (tabla `historial_validaciones`)

| Métrica | Valor |
|---|---|
| Total invocaciones (histórico completo) | **26** |
| Rango temporal | 2026-04-01 → 2026-05-18 (46 días) |
| Últimos 7 días | **0** (función inactiva de facto) |
| Modo `documento` | 23 llamadas |
| Modo `campos` | 3 llamadas |
| Trámites con ≥1 error reportado por Claude | 25 de 26 (96 %) |
| Total errores / advertencias / sugerencias | 65 / 37 / 41 |
| Puntuación promedio | 66 / 100 (documento), 81 / 100 (campos) |
| Costo real acumulado | **0,81 USD** en 46 días |
| Costo por llamada | ~0,031 USD |
| Latencia promedio | **~14,6 segundos** (documento), 11,5 s (campos) |

### Lo que NO se puede saber con los datos actuales
- No existe columna que compare "corrección propuesta por Claude" vs "corrección aceptada por el usuario". `historial_validaciones` guarda `respuesta_claude` como JSON pero no hay flujo que registre aceptación/rechazo.
- No hay forma de responder "¿cuántas veces Claude detectó algo que Gemini no había detectado?" porque no se guarda el output paralelo de Gemini en el mismo trámite para comparar.
- No hay forma de saber "¿cuántas veces cambió el resultado final del trámite?" porque `errores_criticos` no bloquea (usuario decide) y no se registra la decisión.

**Interpretación honesta:** el 96 % de trámites reciben ≥1 error, la puntuación promedio es 66/100. Esto sugiere que Claude está siendo **excesivamente estricto** o que las 35 reglas producen muchos falsos positivos, o que los usuarios están ignorando sistemáticamente sus alertas (cero llamadas en la última semana lo respalda).

---

## 6. Costo real y proyección

Datos históricos: 0,031 USD por llamada real (documento). Consistente con la estimación previa (~9k in / ~2,5k out × $3/$15 = $0,065; el real es la mitad porque hay llamadas de modo `campos` más cortas).

### Proyección si se activa para el 100 % de trámites de escritura

Cada trámite dispara: 1 llamada `documento` + N llamadas `campos` (una por doc subido, típicamente 3-5).
- Costo por trámite ≈ 0,031 × 4 ≈ **0,12 USD** (~510 COP a 4.250 COP/USD).
- Costo por trámite del acto completo (OCR+redacción+claude) actual ≈ 0,18 USD; añadir claude sistemáticamente lo lleva a ≈ 0,30 USD (**+66 %**).

### Impacto mensual estimado

| Volumen mensual | Costo Claude/mes | % del costo IA total |
|---|---|---|
| 100 trámites | 12 USD | +66 % |
| 500 trámites | 60 USD | +66 % |
| 2.000 trámites | 240 USD | +66 % |

Si además se cobra el crédito hoy inexistente por validación (currency `VALIDACION_CLAUDE` está declarada en `credits.ts` pero **nunca se consume**), el costo lo puede absorber el usuario.

**Latencia:** +14 s antes de abrir el preview es UX inaceptable si se hace bloqueante. Como flujo silencioso en background está bien.

---

## 7. Evaluación honesta y opciones

### Diagnóstico
`validar-con-claude` es una capa de auditoría técnicamente elegante que **en la práctica no está aportando valor medible**:

- **Uso real 0** en los últimos 7 días — está desactivado de facto.
- **Solapamiento ~100 %** con reglas que podrían ser deterministas.
- **Nunca bloquea** — el usuario ya aprendió que puede ignorarla.
- **Sin instrumentación** para saber si sus recomendaciones se aceptan.
- **Costo bajo hoy** (< 1 USD histórico) pero escalaría con volumen.
- **Latencia 14 s** limita su uso a background silencioso.
- **Score promedio 66/100** sugiere falsos positivos o umbral mal calibrado.

### Rol claro y diferenciado que SÍ podría cumplir (si se decide mantener)

Un único caso donde Claude aporta valor distinto:

> **"Auditor semántico del texto final generado por Gemini, antes de la firma."**
> Es decir, correr Claude **solo en modo `documento`**, sobre el `texto_preview` ya renderizado, buscando: contradicciones internas del texto, referencias legales mal citadas, párrafos incoherentes que ninguna regla determinista puede detectar. Retirar el modo `campos` (donde las reglas deterministas ganan siempre).

### Tres opciones para decidir

1. **Retirar completo:** eliminar edge function + servicio + call-sites + tabla `historial_validaciones`. Ahorra mantenimiento, cero impacto porque no hay uso.
2. **Reducir alcance:** dejar solo modo `documento`, quitar modo `campos`, quitar reglas duplicadas (dejar 5-8 semánticas), añadir métrica de aceptación (columna `accion_usuario` en `historial_validaciones` + botón "Aceptar sugerencia" / "Rechazar" en el dialog).
3. **Mantener status quo:** no hacer nada. Sigue costando <1 USD/mes y nadie lo usa. Riesgo cero, valor cero.

### Recomendación

**Opción 2 (reducir alcance) o directamente 1 (retirar).** No hay evidencia empírica de que Claude esté detectando algo que salve un trámite. Antes de invertir en formalizarlo, se necesita al menos 1 sprint de instrumentación (registrar aceptación) para demostrar valor. Sin esa evidencia, la elección racional es retirarlo y liberar mental overhead. La segunda opinión es defendible en teoría, pero en este stack Gemini Pro ya hace el trabajo pesado y las reglas deterministas capturan el 90 % de errores estructurales.

---

Espero tu decisión antes de tocar nada.
