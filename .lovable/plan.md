
## Diagnóstico: sí hay dos puntos de entrada y uno es legado

No parece un problema de caché del navegador. Lo que estás viendo corresponde a datos y rutas reales activas en la app.

### Lo que encontré

#### 1) Hay 3 rutas relacionadas y 2 experiencias distintas
En `src/App.tsx` siguen activas estas rutas:

```text
/nuevo-tramite   -> DocumentUploadStep   (flujo nuevo de carga anticipada)
/tramite/nuevo   -> Validacion           (flujo antiguo / entrada vacía)
/tramite/:id     -> Validacion           (reanudar borrador o abrir trámite)
```

Eso significa:

- `+ Nuevo Trámite` entra al flujo nuevo.
- Un borrador en dashboard abre `/tramite/:id`.
- Pero dentro de `DocumentUploadStep` todavía existe el botón:
  `Saltar (formulario vacío)` -> navega a `/tramite/nuevo`.

Conclusión: sí hay un flujo duplicado/legacy todavía expuesto. No es solo “otro punto de entrada” limpio; hoy conviven el flujo nuevo y una entrada antigua a `Validacion`.

#### 2) El borrador que ves no es caché: existe en base de datos
Consulté los borradores pendientes y hay 2 reales:

- `fb139817...` — vacío, sin personas, inmuebles ni metadata útil
- `de0a906c...` — progreso 80%, 2 personas, 1 inmueble, 1 acto

Entonces la tarjeta no “reaparece por caché”; reaparece porque el registro sigue existiendo en backend.

#### 3) Dashboard no usa caché local para los borradores
`Dashboard.tsx` hace fetch directo:

```ts
supabase.from("tramites").select("*, personas(count), inmuebles(count)")
```

y filtra `status === "pendiente"`.

No encontré uso de:
- `serviceWorker`
- `caches`
- `indexedDB`
- `sessionStorage`

Solo hay `localStorage` para persistir la sesión de autenticación en `src/integrations/supabase/client.ts`, no para guardar borradores.

#### 4) La experiencia “parece cacheada” por mezcla de rutas + autosave
En `Validacion.tsx` hay una lógica que si no existe `tramiteId`, crea un borrador nuevo al guardar automáticamente:

```ts
if (!tid) {
  insert into tramites ...
  navigate(`/tramite/${tid}`, { replace: true });
}
```

Además:
- autosave cada 15 segundos
- guardado al salir
- guardado al devolverse al dashboard si hay cambios

Esto hace que entrar por la pantalla antigua (`/tramite/nuevo`) pueda regenerar o persistir borradores aunque el usuario sienta que “solo entró y volvió”.

## Causa raíz

El problema no es caché del navegador. La causa raíz es esta combinación:

1. `DocumentUploadStep` (flujo nuevo) sigue ofreciendo una salida al flujo antiguo:
   `/tramite/nuevo`
2. `Validacion` todavía puede crear borradores por sí sola si entra sin `id`
3. El dashboard muestra cualquier trámite `pendiente`, aunque sea huérfano o provenga del flujo antiguo
4. La eliminación de borradores todavía no está blindada del todo para el nuevo ecosistema de tablas/estados

## Qué construir para dejarlo consistente

### 1) Unificar el punto de entrada
Objetivo: que solo exista un camino para iniciar trámite.

Cambios:
- eliminar o desactivar la ruta `/tramite/nuevo`
- quitar el botón `Saltar (formulario vacío)` o convertirlo en una acción dentro del flujo nuevo
- dejar `/nuevo-tramite` como única entrada de creación

Resultado:
- no más “pantalla antigua” accesible desde la UX actual

### 2) Separar claramente “crear” vs “reanudar”
Objetivo: que `Validacion` no funcione como creador silencioso cuando entra sin `id`.

Cambios:
- `Validacion` debe asumir que recibe un `tramiteId`
- si no hay `id`, redirigir a `/nuevo-tramite`
- mover toda creación inicial de borrador al flujo de carga nueva, con reglas claras

Resultado:
- `/tramite/:id` = reanudar
- `/nuevo-tramite` = crear
- sin comportamientos híbridos

### 3) Endurecer la creación de borradores
Objetivo: no generar borradores basura.

Cambios:
- solo crear trámite cuando exista evidencia mínima real:
  - al menos 1 documento procesado, o
  - cambios manuales relevantes si decides soportar “sin documentos”
- si el usuario entra y sale sin valor real, no debe quedar registro

Resultado:
- desaparecen borradores huérfanos como `fb139817...`

### 4) Mejorar la lógica del dashboard para distinguir borradores válidos
Objetivo: que la tarjeta comunique bien qué abre y oculte basura.

Cambios:
- mostrar solo borradores con señales mínimas de trabajo real
  - progreso > 0, o
  - personas/inmuebles/actos/logs, o
  - metadata relevante
- opcional: separar “borrador vacío” de “borrador retomable”
- agregar badge del origen:
  - “Carga de documentos”
  - “Formulario manual” si decides conservarlo

Resultado:
- menos confusión para el usuario
- menos sensación de “aparece algo raro”

### 5) Blindar la eliminación
Objetivo: que borrar una tarjeta siempre la quite de verdad.

Cambios:
- borrar también `logs_extraccion` antes del trámite
- luego refrescar desde backend después del delete, no confiar solo en estado local
- mostrar error explícito si falla cualquier paso

Resultado:
- no más tarjetas que “vuelven”

### 6) Limpieza y purga coherente
Objetivo: sanear residuos antiguos.

Cambios:
- eliminar borradores legacy existentes
- asegurar que la purga automática también contemple `logs_extraccion`
- definir criterio de expiración solo para `pendiente`

Resultado:
- el dashboard deja de mezclar historia vieja con flujo actual

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/App.tsx` | retirar o redirigir `/tramite/nuevo` |
| `src/components/tramites/DocumentUploadStep.tsx` | quitar “Saltar (formulario vacío)” o migrarlo al flujo nuevo |
| `src/pages/Validacion.tsx` | impedir creación silenciosa sin `id`; usar solo modo reanudar |
| `src/pages/Dashboard.tsx` | mejorar delete, refetch y criterios de visibilidad de borradores |
| Migración SQL | limpiar borradores legacy y ajustar purga automática |

## Respuesta concreta a tu pregunta

- Sí, hoy hay un flujo duplicado/legacy todavía activo.
- El borrador que te manda a la pantalla antigua no es caché: es un registro real que sigue en la base de datos.
- No encontré evidencia de service worker, caché web o almacenamiento local de borradores que esté “dañando” esta experiencia.
- El problema principal es arquitectura de rutas + autosave + borradores legacy coexistiendo.

## Plan de implementación recomendado

1. Desactivar `/tramite/nuevo` como entrada de usuario.
2. Hacer que `Validacion` solo abra trámites existentes.
3. Mantener `/nuevo-tramite` como único flujo de creación.
4. Corregir eliminación de borradores con borrado completo + refetch.
5. Limpiar los borradores legacy actuales.
6. Ajustar el dashboard para mostrar solo borradores realmente retomables.
