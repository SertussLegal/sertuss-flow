
# Inventario de datos de prueba — Sertuss (SOLO LECTURA, nada borrado)

**Organización:** `Sertuss Notaría Central` — NIT `748585969-8` — id `614a4a8d-1d5b-4c84-be92-d09152fd2e21`.

## 1. Cancelaciones (14 filas totales)

| status | count |
|---|---|
| completed | 11 |
| draft | 2 |
| error | 1 |

Rango: **2026-05-20 17:03** → **2026-07-08 01:40** (~7 semanas).

## 2. ¿Prueba vs cliente real?

Todas las filas parecen datos de prueba internos. Evidencia:

- **11 de las 14 filas** usan un único deudor repetido: `MAYA MONTOYA JOHN MIGUEL` + matrícula `50C-2025538` + variando el banco (Davivienda casi siempre, una vez Caja Social). Es el fixture que hemos venido usando para probar NO_LEGIBLE, Fase E y el bug de cuantía null.
- **3 filas de mayo** (`498c0215`, `1e2069b7`, `a21ae265`) usan otro fixture repetido: `LIZETH VANESSA GARCIA GARCIA` + matrícula `50C-2085432`. También patrón de prueba (3 corridas contra el mismo caso).
- **3 borradores/error** sin datos.
- **No hay marcador "test"** en el nombre de la organización ni en un campo dedicado. La única forma honesta de distinguir prueba de real es reconocer los dos fixtures repetidos; no hay señal automática. Si el dueño confirma que **nada** de esta org salió a notaría real, todo es descartable.

## 3. Tablas relacionadas con conteo real

Filtradas por `organization_id = Sertuss` (o joins equivalentes):

| tabla | filas | relación / cascada |
|---|---|---|
| `cancelaciones` | 14 | FK org → **ON DELETE CASCADE** |
| `tramites` | 8 | FK org → **sin ON DELETE** (bloquea si borras org; borrado por id sí funciona) |
| `personas` | 16 | FK tramite_id → **CASCADE** desde tramites |
| `inmuebles` | 8 | FK tramite_id → **CASCADE** |
| `actos` | 8 | FK tramite_id → **CASCADE** |
| `logs_extraccion` | 11 | FK org **CASCADE** + FK tramite_id **CASCADE** |
| `historial_validaciones` | 22 | FK org → **ON DELETE SET NULL** (quedan huérfanos, no se borran) |
| `activity_logs` | 48 | FK org → **sin ON DELETE** (bloquea borrado de org) |
| `credit_consumption` | 24 | FK org → **CASCADE** |
| `system_events` | 313 | sin FK detectada — hay que borrar por `organization_id` a mano |
| `ocr_raw_cache` | 0 | — |

Ninguna otra tabla apunta a `cancelaciones.id`; el borrado directo de esas 14 filas no está bloqueado por FKs.

## 4. Storage (bucket `expediente-files`)

**366 objetos, ~95 MB** con prefijos vinculados a Sertuss:

- 11 prefijos `<cancelacion_id>/…` (33-41 archivos cada uno) para las 11 cancelaciones con archivos subidos.
- Prefijo compartido `cancelaciones/` con 40 archivos (soportes comunes — revisar si son de Sertuss o compartidos globales antes de tocar).
- 8 prefijos `<tramite_id>/…` con 13 archivos cada uno.

Storage **no tiene FK** — no se borra por cascada, hay que hacerlo con `storage.objects` DELETE por prefijo. Bucket `cancelaciones-plantillas` no tiene objetos de esta org.

## 5. Restricciones que bloquearían un borrado

- **Borrar `cancelaciones` (14 filas) por id:** ✅ sin bloqueos, ninguna tabla las referencia.
- **Borrar `tramites` (8 filas) por id:** ✅ hijas (`personas`/`inmuebles`/`actos`/`logs_extraccion`) caen por CASCADE.
- **Borrar `organizations` entera:** ❌ bloquea por `activity_logs.organization_id` (48 filas, sin ON DELETE) y `tramites.organization_id` (sin ON DELETE). Habría que borrar/nulear esos primero. No recomiendo esta ruta salvo que el dueño quiera eliminar la org completa.
- **`system_events` (313):** no tiene FK, no se ve afectado por cascadas — decisión aparte si conservar como telemetría histórica o borrar también.
- **`historial_validaciones` (22):** al borrar la org solo se nulea `organization_id`; permanecen las filas. Si se quiere limpieza total, borrar explícitamente.

## Pregunta pendiente para el dueño antes de autorizar cualquier DELETE

El alcance no está definido todavía. Necesito que confirme una de estas 4 opciones (o combine):

1. **Solo cancelaciones + su storage** (14 filas + ~11 prefijos + `logs_extraccion`/`credit_consumption`/`system_events` relacionados). Conserva `tramites`, `activity_logs`, `historial_validaciones`, la org.
2. **Cancelaciones + tramites** (todo lo transaccional). Conserva org + logs + memberships + config notaría.
3. **Todo lo transaccional + telemetría** (agrega `activity_logs`, `system_events`, `historial_validaciones`, `credit_consumption`). Conserva org, memberships, `configuracion_notaria`, `notaria_styles`.
4. **Wipe total incluyendo la org** (requiere primero borrar `activity_logs` de esa org y otras tablas sin cascada; deja huérfanos a los usuarios de esa org, hay que reasignar contexto activo).

También necesito confirmación explícita sobre:
- ¿El prefijo compartido `cancelaciones/` (40 archivos) en el bucket es de Sertuss o compartido globalmente? Si hay duda, NO tocarlo en esta ronda.
- ¿Restablecer `credit_balance` de la org tras la limpieza, o dejarlo como está?

## Regla firme

Este plan es **inventario únicamente**. Ningún DELETE se ejecutará hasta que el dueño elija opción (1/2/3/4) + resuelva las dos preguntas de arriba. En ese punto redacto un plan de ejecución explícito con las queries exactas (en orden: storage → hijas → padres) y espero segunda aprobación antes de tocar nada.
