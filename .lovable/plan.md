# Fix B/UI-1 — Visibilidad de `revision_manual_requerida` en listado Cancelaciones

## 1. Diagnóstico del terreno

### 1.1 Datos reales (evidencia cruda)

`SELECT id, status, revision_manual_requerida` filtrando por casos "sucios":

| id | status | revision_manual_requerida |
|---|---|---|
| `9dc33048…` | `completed` | `true` ← el caso de hoy |
| `32f5317e…` | `completed` | `true` |
| `2bef1db3…` | `requiere_revision_manual` | `true` |
| `748f3220…` | `requiere_revision_manual` | `true` |
| … 10 filas en total | mezcla | siempre `true` |

**Hallazgo clave:** el flag `revision_manual_requerida` y el status `'requiere_revision_manual'` son **dos señales independientes** que pueden coexistir o divergir:

- `status='requiere_revision_manual'` → bloqueo transitorio, se cambia a `completed` cuando el humano hace `confirm_manual_review`.
- `revision_manual_requerida=true` → **persistente**, sobrevive al confirm. Marca el trámite como "hubo un warning que un humano revisó".

Hoy `9dc33048` (`completed` + flag=true) se pinta como **"Completada" verde** — nada indica que hubo revisión manual. Los que están en `'requiere_revision_manual'` caen al `else` del `StatusBadge` (L61-65 de `Cancelaciones.tsx`) y se pintan como **"Borrador" gris** — indistinguibles de un draft normal. Los dos casos están mal.

### 1.2 Terreno actual de `src/pages/Cancelaciones.tsx`

- **`CancelacionRow`** (L18-25): `status: "draft" | "processing" | "completed" | "error"` — falta `'requiere_revision_manual'` y falta la columna booleana.
- **`select`** (L77): no trae `revision_manual_requerida` ni acepta el status nuevo.
- **`StatusBadge`** (L37-67): `if status==='processing'|'completed'|'error'` → fallback gris "Borrador". El nuevo status cae al fallback.
- **Filtros/tabs/orden:** **no existen** en este archivo. El Dashboard de Escrituras sí tiene `<Select filterStatus>` reusable como patrón conceptual, pero aquí no hay nada instalado.
- **Navegación:** `onClick` de fila → `/cancelaciones/:id/validar`. Ya funciona.

### 1.3 Sidebar y patrón de badge de conteo

Revisé `AppSidebar.tsx` completo. **No existe** un patrón de badge numérico en items del menú. El "46" que se veía en capturas viene del `credit_balance` del org switcher del footer (L162, L286), no de un ítem de navegación. Introducir un badge de conteo en el sidebar sería inventar un patrón nuevo → **fuera de alcance para hoy**, mejor mantenerlo dentro de `/cancelaciones`.

### 1.4 Dashboard como candidato de resumen

`src/pages/Dashboard.tsx` es el listado de **Escrituras**, no un dashboard de resumen cross-módulo. No hay ningún widget de cancelaciones ahí hoy. Meter un contador ahí sería mezclar dominios → **fuera de alcance**.

### 1.5 Otros flags booleanos en la tabla

Revisado el schema de `cancelaciones` (32 columnas). El único booleano de "atención requerida" hoy es `revision_manual_requerida`. No hay `requiere_ajuste_manual`, ni `poder_defectuoso`, ni similares. **No hay que generalizar** — sobreingeniería para un solo flag. Diseño 1:1.

### 1.6 Tests existentes de `Cancelaciones.tsx`

`ls src/pages/__tests__` no existe y no hay `.test.` para esta página. Cero cobertura previa. Puedo agregar tests nuevos sin romper nada.

---

## 2. Diseño propuesto

**Principio:** dos señales visuales, misma prioridad visual — un badge de status (el actual) + un chip inline "Revisión manual" cuando el flag está activo. El chip **sobrevive** aunque el status haya avanzado a `completed`.

### 2.1 Estados visuales

| status \ flag | flag=false | flag=true |
|---|---|---|
| `draft` | gris "Borrador" | gris "Borrador" + chip ámbar 🚩 "Revisión manual" |
| `processing` | ámbar animado "Procesando" | mismo + chip |
| `completed` | verde "Completada" | verde "Completada" + chip |
| `error` | rojo "Error" | rojo "Error" + chip |
| `requiere_revision_manual` | **NUEVO:** rojo "Revisión manual bloqueante" | mismo (los dos suelen ir juntos) |

El chip usa `bg-amber-50 border-amber-300 text-amber-900` con icono `AlertTriangle` — distinto del "Procesando" ámbar+spinner y del "Borrador" gris.

### 2.2 Filtro por Tabs (no Select)

Tres tabs sobre la tabla, sin dropdown — patrón más ligero y ya usado en Admin:
- **Todas** (default, N)
- **Requieren revisión** (M) — filtra `revision_manual_requerida=true OR status='requiere_revision_manual'`
- **Completadas** (K) — `status='completed' AND revision_manual_requerida=false`

Los conteos se calculan en cliente sobre `rows` ya cargadas (todo cabe en un `select` — la lista total de una notaría ronda las decenas, no miles).

### 2.3 Orden

Añadir orden secundario: filas con `revision_manual_requerida=true` **primero**, luego por `updated_at desc`. Así aparecen arriba del todo sin necesidad de filtrar.

```sql
ORDER BY revision_manual_requerida DESC, created_at DESC
```

---

## 3. Diff propuesto

### 3.1 `src/pages/Cancelaciones.tsx`

**Tipo (L18-25):**
```diff
 type CancelacionRow = {
   id: string;
   matricula_inmobiliaria: string | null;
   deudor_nombre: string | null;
   deudor_cedula: string | null;
-  status: "draft" | "processing" | "completed" | "error";
+  status: "draft" | "processing" | "completed" | "error" | "requiere_revision_manual";
+  revision_manual_requerida: boolean;
   created_at: string;
 };
```

**Select (L77):**
```diff
-        .select("id, matricula_inmobiliaria, deudor_nombre, deudor_cedula, status, created_at")
-        .order("created_at", { ascending: false });
+        .select("id, matricula_inmobiliaria, deudor_nombre, deudor_cedula, status, revision_manual_requerida, created_at")
+        .order("revision_manual_requerida", { ascending: false })
+        .order("created_at", { ascending: false });
```

**`StatusBadge` (L37-67):** añadir caso `'requiere_revision_manual'` (rojo con icono `AlertTriangle`). Sin tocar los demás.

**Nuevo `ManualReviewChip`:** chip ámbar independiente que se renderiza junto al `StatusBadge` cuando `row.revision_manual_requerida === true`.

**Nueva sección de filtros:** `<Tabs>` shadcn arriba del `<Table>` con los 3 tabs y conteos. Filtra `rows` en memoria antes de mapear.

**Celda status (columna existente):**
```diff
-<TableCell><StatusBadge status={row.status} /></TableCell>
+<TableCell>
+  <div className="flex items-center gap-1.5">
+    <StatusBadge status={row.status} />
+    {row.revision_manual_requerida && <ManualReviewChip />}
+  </div>
+</TableCell>
```

Todo lo demás del archivo (skeleton, empty state, navegación, botón "Abrir") **queda igual**.

### 3.2 Nuevo `src/pages/Cancelaciones.test.tsx`

Tests con Vitest + Testing Library. Cuatro casos:

1. **Fila con `revision_manual_requerida=true` muestra chip "Revisión manual"** aunque status sea `completed`. Regresión directa del hallazgo `9dc33048`.
2. **Status `'requiere_revision_manual'` renderiza badge rojo distintivo** — no cae al fallback gris "Borrador".
3. **Tab "Requieren revisión" filtra correctamente** — solo muestra filas con flag=true o status bloqueante; ocultan las demás.
4. **Los estados existentes (`draft/processing/completed/error`) sin flag siguen renderizando su badge original** — protección anti-regresión de los 4 estados que ya funcionaban.

### 3.3 No se toca

- `AppSidebar.tsx` (no hay patrón de badge de menú).
- `Dashboard.tsx` (dominio distinto).
- `CancelacionValidar.tsx` (la vista detalle ya muestra el banner del poder).
- `PoderBannersV5.tsx` (ya lee `manualReviewPending`).
- Backend: cero cambios. El flag ya se persiste correctamente en `procesar-cancelacion/index.ts` L2953-2958.
- Migraciones: cero.

---

## 4. Criterios de aceptación

- [ ] `9dc33048` (completed + flag) aparece con badge verde "Completada" **y** chip ámbar "Revisión manual" a su lado en el listado.
- [ ] Filas con `status='requiere_revision_manual'` se pintan con badge rojo, no gris "Borrador".
- [ ] Filas con flag=true aparecen ordenadas **primero** en la tabla.
- [ ] Tab "Requieren revisión" muestra el conteo real y filtra correctamente.
- [ ] Los 4 estados originales siguen pintándose igual que hoy cuando el flag es false.
- [ ] Vitest 220 → 224 (o similar, con 4 tests nuevos verdes). Deno sin cambios (66/66).
- [ ] `tsgo` sin errores por el tipo ampliado.

## 5. Fuera de alcance (explícito)

- Badge numérico en sidebar (no hay patrón previo — sería inventar).
- Widget cross-módulo en Dashboard (mezcla dominios).
- Generalizar a otros flags (solo existe uno hoy).
- Notificación email / toast automático cuando aparece un caso nuevo.
- Reordenar la sección "Historial" en función del flag para escrituras (`tramites` no tiene este flag).
