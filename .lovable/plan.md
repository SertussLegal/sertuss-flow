
# Diagnóstico (solo lectura) — Modal de confianza + rol viable para `validar-con-claude`

## PARTE A — El "modal / indicador de confianza" hoy

### 1. ¿De dónde sale el porcentaje?
No existe un porcentaje único global. Coexisten **dos fuentes distintas** que el dueño del producto probablemente agrupa mentalmente como "confianza":

**(a) Confianza por-campo del OCR (Gemini `scan-document`)** — LA PRINCIPAL, siempre activa.
- Cada campo del schema viene envuelto en `{ valor, confianza: "alta"|"media"|"baja" }` (ver `supabase/functions/scan-document/shared/confFields.ts`).
- Se desempaqueta en `DocumentUploadStep.tsx` (líneas 314–445) construyendo `confianzaMap: Record<string, "alta"|"media"|"baja">`, se persiste en `tramites.metadata.confianza_map` y se rehidrata en `Validacion.tsx:414`.
- Se muestra como **borde ámbar + tooltip "Verificación requerida — la IA tiene baja confianza en este dato"** en `PersonaForm.tsx:148` e `InmuebleForm.tsx:358`. También como contador agregado ("N campo(s) con baja confianza" en `DocumentUploadStep.tsx:804` y `lowConfCount` en `Validacion.tsx:317`).
- **No hay un "%" numérico**: son 3 niveles categóricos por campo.

**(b) Puntuación 0-100 de Claude** — el que probablemente el dueño llama "modal de %".
- `validacionResultado.puntuacion` viene de `validar-con-claude` (regla: 100 − 15 por error − 5 por advertencia − 1 por sugerencia).
- Se muestra únicamente dentro del `AlertDialog` en `Validacion.tsx:3511–3611` ("Revisión de validación → Puntuación: 66/100"), y como toast si no hay errores críticos (`Validacion.tsx:1994`). El diálogo se abre solo cuando `tieneErroresCriticos === true` justo antes de generar el .docx.

### 2. "Anotaciones proactivas" — qué son y ejemplos
Son las entradas de `validacionResultado.validaciones[]` que Claude devuelve, renderizadas en 3 bloques del mismo AlertDialog: **Errores** (rojo, `AlertCircle`), **Advertencias** (amarillo), **Sugerencias** (azul, `Info`). Cada una muestra `campo`, `explicacion`, y opcionalmente `valor_sugerido`.

Ejemplos reales según reglas activas en el prompt (`validar-con-claude/index.ts`) e `historial_validaciones`:
- **Error (FMT_CEDULA_DIGITOS):** *"vendedor[0].numero_cedula: contiene puntos o letras. Sugerido: 52123456"*.
- **Advertencia (COH_NOTARIA_ORIGEN):** *"notaria_tramite.numero_notaria: el certificado de tradición muestra Notaría 25, pero el trámite está configurado como Notaría 32"*.
- **Sugerencia (CUSTOM / datos de notaría detectados):** *"notaria_tramite.nombre_notario: detectado 'Juan Pérez' en escritura previa; considera aceptarlo"* (con `auto_corregible:true` para acepto de 1 clic).

Los **badges inline dot** (rojo/amarillo/azul junto al input) usan `inlineBadgeMap` generado por `obtenerInlineBadges(validaciones)` — también proceden de Claude, no de reglas locales.

Nota: los **borde ámbar por-campo** son de OCR (Gemini), NO de Claude. Son "anotaciones proactivas" en un sentido más amplio, pero de otro origen.

### 3. ¿Por qué no existe en cancelaciones?
Se revisó `CancelacionValidar.tsx`: **cero referencias** a `puntuacion`, `validar-con-claude`, `confianzaFields`, `NivelConfianza` o `confianza_map`. Concurrentemente:

- **Falta la llamada al modelo auditor**: `procesar-cancelacion` extrae con Gemini pero no invoca `validar-con-claude` ni guarda `confianza_map` equivalente.
- **Falta el pipeline de metadata**: `DocumentUploadStep.tsx` es exclusivo del flujo escrituras. En cancelaciones el OCR se hace por `scan-document` con tool `poderBanco` que sí devuelve `{valor, confianza}`, pero el resultado no se enruta a un mapa persistente.
- **Sí existe una lógica sustituta parcial**: `cancelacionCriticalFields.ts` + banners rojos `AlertCircle` para campos obligatorios faltantes (Davivienda). Es determinista, no probabilística.

Conclusión: no es limitación de modelo, es que **el pipeline de "extraer confianza → persistir → pintar ámbar → auditar con Claude" nunca se cableó en el flujo de cancelaciones**. No se priorizó porque el flujo es más corto (menos campos, menos documentos cruzados) y el riesgo percibido menor.

---

## PARTE B — Roles viables para `validar-con-claude`

### Idea 1 — "Modo descubrimiento" batch semanal
**Viabilidad: ALTA. Esfuerzo: BAJO-MEDIO (2-3 días).**
- Los datos ya están: `historial_validaciones` guarda `datos_enviados` + `respuesta_claude` completos; `tramites.metadata` guarda estado final; `credit_consumption` marca APERTURA_EXPEDIENTE (=trámite realmente cerrado). Se puede filtrar "trámites completados en los últimos 7 días" y re-someterlos a un prompt distinto: *"dado este set, sugiere reglas deterministas nuevas que hubieran detectado errores no capturados por las 35 reglas actuales"*.
- No requiere UI en el flujo de usuario final; solo una edge function cron + una tabla `regla_propuesta` que el admin revisa/aprueba/rechaza. Encaja con el patrón "extensibilidad por datos" del proyecto.
- Ventaja estratégica clara: **convierte a Claude de auditor pasivo a generador de reglas** — cada regla aprobada elimina llamadas futuras. Es el único modo donde Claude no es redundante con Gemini y produce un ROI compuesto.
- Riesgo: propuestas de reglas de baja calidad si el prompt no está afinado. Requiere loop humano obligatorio.

### Idea 2 — "Síntesis de plan de acción"
**Viabilidad: ALTA. Esfuerzo: MUY BAJO (medio día).**
- No necesita Claude en absoluto para el 80% del caso. Los datos ya tienen `priority` (high/medium/low) y `nivel`; una función `top3(validaciones)` que ordene por `priority + nivel + campos_relacionados.length` cubre la síntesis sin llamada nueva.
- Si se quiere prosa humana ("Antes de enviar revisa: 1... 2... 3..."), se puede pedir a Claude en la MISMA llamada actual, agregando un campo `plan_accion: string[3]` al schema JSON. Cero costo marginal.
- **Sin embargo**: es cosmético. No resuelve la crítica del diagnóstico previo (Claude no aporta señales nuevas). Bueno como mejora UX, malo como justificación para mantener el gasto.

### Idea 3 — Extender indicador de confianza + anotaciones a cancelaciones
**Viabilidad: ALTA. Esfuerzo: MEDIO (3-5 días).**
- **Parte OCR/ámbar (~1-2 días)**: el `scan-document` de `poderBanco` ya devuelve `{valor, confianza}`. Falta: (a) construir `confianzaMap` análogo en el handler de subida de cancelación, (b) persistirlo en `cancelaciones.metadata.confianza_map`, (c) agregar prop `confianzaFields` a los inputs del `CancelacionValidar.tsx` copiando el patrón de `PersonaForm`. Trabajo casi mecánico.
- **Parte Claude (~2-3 días)**: registrar plantilla `cancelacion_hipoteca` + reglas específicas en `plantillas_validacion` y `reglas_validacion` (hoy solo hay reglas de compraventa/hipoteca); agregar llamada a `validarConClaude({modo:"campos", tipo_acto:"cancelacion_hipoteca"})` en el botón "Generar". El edge function ya es multi-tipo (`.or(...tipo_acto...)`), no hay que tocarlo.
- **Complejidad ya cubierta parcialmente**: `cancelacionCriticalFields.ts` cubre campos obligatorios (rojo/AlertCircle) — es más fuerte que "confianza ámbar" porque bloquea visualmente. Lo que **falta genuinamente** es: cruces multi-documento (poder banco vs certificado de tradición vs escritura hipoteca), detección de notaría origen, coherencia de valor del crédito. Ahí sí aporta.

---

## Recomendación técnica

1. **Idea 1 (modo descubrimiento) es la única que justifica formalmente mantener Claude activo** — le da un rol único, no redundante, y con ROI decreciente (cada regla generada reduce el gasto futuro). El costo es <$5/mes (26 trámites, 1 corrida/semana).
2. **Idea 2** implementarla como mejora UX del actual `AlertDialog` **sin llamada extra** (top-3 determinista sobre `validaciones[]`). No amerita mantener Claude por sí sola.
3. **Idea 3 (extender a cancelaciones)** solo tiene sentido *después* de decidir sobre Claude. Si Claude se retira, se puede extender únicamente el pipeline OCR/ámbar (más útil, más barato, sin dependencia de Claude). Si Claude se queda con rol batch (Idea 1), agregar cancelaciones al corpus del batch cuesta cero.

**Camino más limpio**: Idea 1 + Idea 2 (versión determinista) + Idea 3 sub-parte OCR/ámbar. Retirar la llamada en-vivo de `validar-con-claude` de `Validacion.tsx` (2 call-sites) pero conservar la edge function reconvertida a job semanal.

Sin cambios de código aplicados. Esperando decisión.
