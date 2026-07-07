# Auditoría adversarial post-migración RLS (solo lectura)

Reviso el trabajo con escepticismo. Encuentro **1 hallazgo material** que el reporte anterior no cubrió y varias observaciones menores. **Sin cambios propuestos** — este "plan" es el informe pedido; espera tu instrucción antes de tocar nada.

---

## 1. DDL real post-migración (16 policies) — coincide con el diseño

Verificado vía `pg_policies`. Las 16 policies quedaron exactamente como el SQL diseñado, sin condiciones invertidas ni typos:

- `tramites` (SELECT/UPDATE/DELETE/INSERT): `organization_id = get_active_org(auth.uid()) AND is_org_member(organization_id) AND (role∈{owner,admin} OR created_by=auth.uid())`. INSERT sin la cláusula de rol/creador (correcto: cualquier miembro puede crear).
- `configuracion_notaria` SELECT + ALL: idem, con `is_org_member` añadido.
- `notaria_styles` SELECT + ALL: idem.
- `logs_extraccion` SELECT/UPDATE/INSERT: `org=active_org AND is_org_member AND EXISTS(tramites …)`.
- `historial_validaciones` SELECT: idem. INSERT (`Service role can insert history`, `WITH CHECK true`) **no tocada**, como se diseñó.
- `credit_consumption`: INSERT service_role con `NOT NULL AND credits>0`; UPDATE/DELETE `USING (false)`. SELECT policies (`Own consumption visible`, `Org admins see active org consumption`) **no fueron tocadas** — bien, no estaban en scope.

**Sin desviaciones sintácticas ni lógicas respecto al plan.**

## 2. `is_org_member` vs datos reales de memberships — sin falsos negativos posibles hoy

`is_org_member(p_org_id)` = `EXISTS(memberships WHERE user_id=auth.uid() AND organization_id=p_org_id)`. La tabla `memberships` **no tiene columna `status`** ni ningún flag de inactividad; `is_personal=true` cuenta igual que cualquier otra membresía. Datos reales:

- 2 memberships totales, 2 usuarios, 2 orgs.
- 0 organizaciones sin ninguna membresía.
- 0 filas en `user_active_context` cuyo `active_org` no exista en `memberships` del mismo usuario.

→ Ningún usuario legítimo puede fallar `is_org_member` por un flag no considerado. **No hay riesgo de lock-out por este vector.**

## 3. HALLAZGO — `configuracion_notaria` y `notaria_styles` están **vacías**

```
SELECT organization_id, count(*) FROM configuracion_notaria GROUP BY 1;  -- 0 rows
SELECT organization_id, count(*) FROM notaria_styles       GROUP BY 1;  -- 0 rows
```

**El reporte anterior afirmó "usuario legítimo sigue viendo sus propios datos sin restricción nueva" pero en estas dos tablas eso es literalmente imposible de haber verificado: no hay una sola fila para leer.** Cualquier "prueba de lectura" que se haya hecho sobre estas tablas devolvió `[]` tanto antes como después de la migración, y ese `[]` no distingue entre "no hay datos" y "RLS te bloqueó de más". Severidad: **baja hoy** (no hay usuario impactado ahora), pero es una **afirmación no respaldada** del turno anterior. En el momento que un admin cree su primera configuración/estilo, si algo estuviera mal en la policy no lo veríamos hasta ese instante. Mitigación real requeriría o insertar una fila de prueba y leerla con JWT real, o revisión estática cuidadosa (que hicimos y da OK).

## 4. `logs_extraccion` UPDATE más estricta — riesgo residual bajo

- 0 filas actualizadas en las últimas 2h; última update real fue 2026-05-18. Nada que observar en vivo.
- Callers actuales de UPDATE sobre `logs_extraccion`:
  - Edge functions (`scan-document`, `descubrir-reglas`, `process-expediente`, `procesar-cancelacion`) usan **service_role → RLS bypass**. No afectadas.
  - `set_logs_extraccion_org` es un trigger SECURITY DEFINER → bypass.
  - No encuentro un caller autenticado (`authenticated` role) que haga UPDATE directo desde el cliente.
- El WITH CHECK exige que `tramite_id` apunte a un trámite de la misma `active_org` y con permisos de rol/creador. Si algún proceso autenticado intentara actualizar un log cuyo trámite fue reasignado o cuyo usuario perdió permisos, fallaría silenciosamente — pero ese escenario no existe hoy.

**Sin evidencia de regresión.** Riesgo teórico si en el futuro se agrega un UPDATE autenticado directo.

## 5. Logs de errores post-migración — inconcluyentes

- `system_events` en las últimas 3h: **0 filas** de cualquier tipo (`resultado`).
- 0 trámites y 0 cancelaciones actualizados en las últimas 2h.

**No hay tráfico de producción posterior a la migración para observar.** Esto significa que la afirmación "sin regresiones" del turno anterior está soportada por (a) tests unitarios que **no ejercen RLS con JWT real**, (b) un script Playwright que sólo probó cross-org negativo. No hay confirmación empírica de flujos legítimos post-migración porque nadie los ha ejecutado desde entonces.

## 6. Generación de documentos post-migración — sin actividad

- `max(tramites.updated_at)` = 2026-05-20.
- `max(cancelaciones.updated_at)` = 2026-07-06 16:47 (anterior a la migración de las 10:02:40 UTC del 07-07… nota: la migración corrió después).

Ningún documento se ha generado ni actualizado desde la migración. **No podemos confirmar ni negar regresiones en el pipeline docx por observación.** Sólo por análisis estático: los flujos de generación usan edge functions con service_role (bypass RLS), y las lecturas del cliente (`tramites`, `configuracion_notaria`, `notaria_styles`) mantienen la misma condición base `organization_id = get_active_org(auth.uid())` — el `AND is_org_member` es tautológico para cualquier usuario cuya `active_org` fue seteada correctamente vía `set_active_context` (que exige membresía). Consistente con el hallazgo #2.

## 7. Veredicto adversarial

**Mantengo que no hay regresión funcional demostrable**, pero **matizo el reporte anterior**:

| Afirmación previa | Realidad verificable |
|---|---|
| "Usuario legítimo sigue viendo sus propios datos sin restricción nueva" en las 6 tablas | **Cierto por análisis estático**; falso como "prueba empírica" para `configuracion_notaria` y `notaria_styles` (están vacías). Para las otras 4, no hubo tráfico post-migración que observar. |
| "Sin regresiones" (Playwright + tests) | Los tests unitarios corren sobre mocks/lógica pura, no ejercen RLS. El Playwright cross-org sólo verificó el caso *negativo* (bloqueo del atacante). La verificación *positiva* (usuario legítimo leyendo sus filas) sí se hizo en el script pero sobre las tablas donde SÍ hay datos. |
| "96/96 verde" | Correcto, pero irrelevante para RLS. |

**Riesgo real remanente:** ninguno crítico. El único vector que no puedo cerrar sin datos es la lectura empírica de `configuracion_notaria`/`notaria_styles` con JWT real cuando existan filas. Se puede cerrar en el momento que un admin cree su primera fila (o insertando manualmente una fila de smoke-test que luego se borre).

**No propongo cambios.** Espera tu decisión: (a) aceptar el estado actual, (b) hacer un smoke-test con inserción/lectura/borrado en `configuracion_notaria`+`notaria_styles` con JWT real, (c) rollback parcial, (d) otro.
