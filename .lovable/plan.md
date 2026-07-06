# Reconversión de `validar-con-claude`: de auditor en vivo a descubridor de reglas

Solo diseño. Nada se implementa hasta aprobación.

## 1. Modelo de datos

### Nueva tabla `regla_propuesta`

Ubicación conceptual: hermana de `reglas_validacion` (una alimenta a la otra, pero son ciclos distintos).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `created_at` | timestamptz | default `now()` |
| `run_id` | uuid | agrupa todas las propuestas de una misma corrida del job (para filtrar el reporte) |
| `tipo_acto` | text | `compraventa` / `hipoteca` / `cancelacion` / `poder` / `*` |
| `categoria` | text | igual a `reglas_validacion.categoria` (`formato` / `coherencia` / `legal` / `negocio`) |
| `nivel_severidad_sugerido` | text | `error` / `advertencia` / `sugerencia` |
| `titulo` | text | resumen corto legible (ej: "Falta validar concordancia de género en cónyuges de vendedor") |
| `descripcion` | text | qué patrón detectó y por qué las 35 reglas actuales no lo cubren |
| `regla_deterministica_sugerida` | jsonb | pseudocódigo / condición estructurada lista para codificar en TS o SQL |
| `campos_afectados` | text[] | rutas de campos (`vendedores[].estado_civil`, `inmueble.matricula`, …) |
| `evidencia` | jsonb | array `{ tramite_id, snippet, explicacion }` — 3 a 5 ejemplos concretos |
| `frecuencia_estimada` | int | cuántos de los N trámites analizados exhibirían la falla |
| `estado` | text | `pendiente` (default) / `aprobada` / `rechazada` / `editada` |
| `resolved_at` | timestamptz | null hasta que un admin decide |
| `resolved_by` | uuid | `auth.users.id` (SuperAdmin) |
| `resolucion_nota` | text | por qué se rechazó, o qué se editó |
| `regla_creada_id` | uuid | FK a `reglas_validacion.id` cuando `estado='aprobada'` (traza) |

**Grants + RLS**: `GRANT ALL … TO service_role`; `GRANT SELECT, UPDATE ON … TO authenticated` con policy `USING (public.is_platform_admin())` — solo SuperAdmin lee/decide. Inserta solo el job (service_role).

Tabla auxiliar `regla_propuesta_run`:

| Columna | Tipo |
|---|---|
| `id` (uuid PK = run_id) | uuid |
| `started_at` / `finished_at` | timestamptz |
| `tramites_analizados` | int |
| `propuestas_generadas` | int |
| `disparado_por` | text (`manual` / `cron`) |
| `disparado_por_user` | uuid nullable |
| `costo_usd_estimado` | numeric(10,4) |
| `tokens_input` / `tokens_output` | int |
| `error` | text nullable |

Sirve para el historial en el panel y para calcular tendencia de costo.

## 2. Disparo del job

**Recomendación: botón manual primero, cron después.**

- Volumen: pocas decenas/semana → un cron semanal correría con muy poca materia prima las primeras semanas y gastaría créditos en corridas vacías.
- La primera versión suele necesitar iteración del prompt; con manual el owner corre, revisa, ajusta, sin ruido de cron.
- Añadir cron una vez validado el flujo son ~10 líneas (`pg_cron` semanal → invoca la misma edge function con header `X-Trigger: cron`).

Guardas del disparo manual:
- Solo SuperAdmin.
- Bloqueado si hay un `run` iniciado hace <5 min sin `finished_at`.
- Advertencia si `tramites_analizados` proyectado <5 (nada útil que descubrir).

## 3. Lógica y prompt del job

### Selección de trámites
- `status='word_generado'` (o equivalente cerrado) **AND** `updated_at BETWEEN last_run AND now()` (o últimos 30 días en la primera corrida).
- Excluir borradores, incompletos y los que ya fueron material de un run anterior (columna `analizado_en_run_id` o join contra `regla_propuesta_run`).
- Cap duro: **máximo 50 trámites por run** para acotar costo y ventana de contexto.

### Datos que se pasan a Claude
Por cada trámite, un objeto compacto (no el docx entero):
```json
{
  "tramite_id": "…",
  "tipo_acto": "compraventa",
  "datos_finales": { /* personas, inmuebles, actos ya validados por humano */ },
  "correcciones_humanas": [ /* diffs entre data_ia y data_final desde logs_extraccion */ ],
  "validaciones_disparadas": [ /* validaciones deterministas que sí saltaron */ ]
}
```
Plus un bloque global con:
- Catálogo actual de las 35 reglas (`codigo_regla`, `descripcion`, `categoria`).
- Reglas notariales colombianas base (formato `TEXTO (NÚMERO)`, concordancia de género, CHIP vs cédula catastral, SARLAFT, etc.).

### Instrucción central
> "Analiza los N trámites cerrados. Identifica **patrones de error o inconsistencia recurrentes** que el humano corrigió manualmente **y que las reglas actuales no detectaron**. Para cada patrón, propone una regla determinista nueva. Ignora casos únicos: mínimo 2 ocurrencias. No propongas reglas que dupliquen las existentes."

### Formato de respuesta (tool call estructurado)
```json
{
  "propuestas": [
    {
      "titulo": "...",
      "descripcion": "...",
      "categoria": "coherencia",
      "nivel_severidad_sugerido": "advertencia",
      "tipo_acto": "compraventa",
      "campos_afectados": ["vendedores[].estado_civil"],
      "regla_deterministica_sugerida": {
        "cuando": "vendedor.estado_civil === 'casado'",
        "entonces_requerir": ["vendedor.conyuge_nombre", "vendedor.conyuge_cc"],
        "mensaje": "Vendedor casado requiere datos del cónyuge"
      },
      "evidencia": [
        { "tramite_id": "…", "snippet": "…", "explicacion": "el humano añadió cónyuge manualmente" }
      ],
      "frecuencia_estimada": 4
    }
  ]
}
```

El backend valida el schema (zod), rechaza propuestas con <2 evidencias, inserta en `regla_propuesta` con `estado='pendiente'`.

## 4. Panel de Admin

**Verificación del Admin actual** (`src/pages/Admin.tsx` + `AdminOrgEdit.tsx` + `SystemMonitor.tsx`):
- Hoy Admin tiene 2 tabs: **Organizaciones** y **Monitor del Sistema**.
- No existe ninguna sección de gestión de reglas de validación. `reglas_validacion` se gestiona solo por SQL/seed.
- `AdminOrgEdit` es per-organización (plantillas, notarías) — no encaja.

**Propuesta: tab nuevo "Reglas propuestas"** en `Admin.tsx`, al lado de Organizaciones y Monitor.

### Estructura del tab
1. **Header con acción**: botón `Ejecutar análisis ahora` (disabled si run en curso) + info del último run (fecha, trámites analizados, costo).
2. **Filtros**: estado (`pendiente` por defecto), tipo_acto, run_id (histórico).
3. **Tabla `PropuestasTable`**:
   | Título | Tipo acto | Severidad | Frecuencia | Estado | Acciones |
   Row clickeable → abre modal.
4. **Modal `PropuestaDetail`**:
   - Descripción + categoría + campos afectados.
   - Bloque "Regla determinista sugerida" (JSON legible).
   - Sección **Evidencia**: lista de trámites con link `/escrituras/:id` y snippet.
   - 3 botones: **Aprobar** (crea fila en `reglas_validacion` vía RPC `admin_aprobar_regla_propuesta`), **Editar** (form inline para ajustar título/severidad/JSON antes de aprobar), **Rechazar** (pide nota).
5. **Historial de runs** (colapsable abajo): tabla con `regla_propuesta_run` — fecha, disparado por, trámites, propuestas, costo, errores.

### Componentes nuevos
- `src/components/admin/PropuestasTab.tsx`
- `src/components/admin/PropuestaDetailModal.tsx`
- `src/components/admin/RunHistoryTable.tsx`
- `src/services/reglasPropuestas.ts` (list/approve/reject/edit/runNow)

### RPC nueva
`admin_aprobar_regla_propuesta(p_propuesta_id, p_overrides jsonb)` → SECURITY DEFINER, chequea `is_platform_admin()`, inserta en `reglas_validacion`, marca `estado='aprobada'` + `regla_creada_id`, log en `activity_logs`.

## 5. Costo estimado del job (framework `pricing-creditos-sertuss`)

**Aquí es costo interno de Sertuss, no se cobra al cliente**, pero aplicamos igual la disciplina.

Pipeline por run (50 trámites cap):
- 1 llamada a Claude Sonnet con contexto grande.
- Input estimado: 50 trámites × ~2K tok/trámite + catálogo reglas ~3K + prompt ~2K ≈ **105K tokens input**.
- Output: propuestas + evidencia estructurada ≈ **8K tokens output**.

Precios Claude Sonnet 4 aprox (verificar vigentes al implementar): $3/M input, $15/M output.
- Costo por run: `105 × 0.003 + 8 × 0.015 ≈ $0.435 USD`.
- A razón de 4 runs/mes: **~$1.75 USD/mes**. Despreciable.

Alternativa: `google/gemini-2.5-pro` via Lovable Gateway → precio distinto, pero mismo orden de magnitud. Decidir en fase 1 tras primer benchmark.

Telemetría obligatoria (checklist del skill): `regla_propuesta_run` guarda `tokens_input`, `tokens_output`, `costo_usd_estimado`. Alerta en `system_events` si `costo > $2 USD/run`.

Nota: al no ser una `CreditAction` de cliente, **no toca `credit_prices` ni el enum** — el skill de pricing no exige aprobación humana previa aquí, pero sí la hoja de costo en el PR.

## 6. Retirada del auditor en vivo

Cambios en frontend (fase 1, junto con retirada):
- `src/pages/Validacion.tsx`: eliminar los 2 call-sites (`validarDespuesDeCarga` línea 1345 y `validarConClaude` línea 1963) y el estado `validacionResultado` / `validacionCampos`.
- Sustituir el "top 3 a revisar antes de enviar" por un helper determinista `computeTopIssues(datos, reglasDeterministas)` que reusa las 35 reglas ya activas — sin IA.
- Mantener `src/services/validacionClaude.ts` como stub por 1 release (para no romper imports en tests), marcado deprecated. Retirar en fase 3.
- Quitar el botón "Prueba de Validación con IA" del Admin (líneas 187-230 aprox), o repurposearlo como "Correr análisis de descubrimiento".

## 7. Plan de implementación en fases

### Fase 1 — Retirada + cimientos (1 sprint)
1. Retirar llamadas en vivo de Claude en `Validacion.tsx`.
2. Implementar `computeTopIssues` determinista.
3. Migración: crear tablas `regla_propuesta` + `regla_propuesta_run` + RPC `admin_aprobar_regla_propuesta` + grants + RLS.
4. Deploy sin edge function nueva todavía → verificar que UX sigue igual sin Claude en vivo.

### Fase 2 — Job + panel MVP (1 sprint)
5. Reescribir `validar-con-claude/index.ts` como job de descubrimiento (input: rango de fechas o últimos N; output: filas en `regla_propuesta`). Renombrar internamente si conviene (`descubrir-reglas`), manteniendo el nombre de function por compatibilidad de despliegue.
6. Tab "Reglas propuestas" en Admin con tabla + modal + botón "Ejecutar análisis ahora".
7. RPC de aprobar/rechazar/editar cableadas.
8. Primera corrida real con los últimos 30 días → iterar prompt hasta que las propuestas sean útiles.

### Fase 3 — Automatización y limpieza (backlog)
9. `pg_cron` semanal (domingo 3 AM) invocando la function con header `X-Trigger: cron`.
10. Retirar stub `validacionClaude.ts` y tipos obsoletos.
11. Métrica: % de propuestas aprobadas / rechazadas por run (indicador de calidad del prompt).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Prompt genera ruido (propuestas triviales o duplicadas) | Filtro server-side: rechazar si `frecuencia_estimada<2` o si el `codigo_regla` sugerido choca con una regla existente por similitud de campos afectados |
| Bajo volumen no da patrones | Ventana rodante de 90 días en las primeras corridas |
| Datos sensibles a Claude | Enviar solo campos estructurados ya validados; nunca el docx completo ni PDFs |
| Runs concurrentes | Advisory lock en la RPC de disparo |

## Checklist de aprobación

- [ ] ¿OK el modelo de datos (2 tablas) o prefieres una sola tabla plana?
- [ ] ¿OK botón manual en Fase 1, cron en Fase 3?
- [ ] ¿OK tab nuevo "Reglas propuestas" en `/admin`?
- [ ] ¿OK Claude Sonnet, o quieres benchmark contra Gemini 2.5 Pro antes?
- [ ] ¿OK cap de 50 trámites/run?
