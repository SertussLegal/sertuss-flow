
Objetivo acordado
- Alcance: Validación + reglas globales.
- Desktop: bloqueo flexible (evitar scroll “fantasma” del documento, pero permitir scroll global cuando realmente corresponde, p. ej. modales o pantallas largas).
- Mobile: mantener scroll natural.

Diagnóstico (basado en el código actual)
1. En `DocxPreview`, el contenedor de medición (`measureRef`) está en `position: absolute` sin un ancestro posicionado (`relative`), así que puede “escaparse” al flujo global y aumentar la altura scrolleable de la página.
2. Hay mezcla de contenedores con `h-screen`, `overflow-auto` y paneles internos; si falta `min-h-0`/`overflow` en un nivel, se propaga overflow al `body`.
3. Falta una regla global consistente para evitar desbordes horizontales y estabilizar el viewport base en todas las rutas.

Plan de implementación
1. Endurecer base global del layout (sin romper otras pantallas)
- En estilos globales:
  - `html, body, #root { height: 100%; }`
  - `body { overflow-x: hidden; }`
- Objetivo: eliminar cualquier overflow lateral/global accidental.

2. Corregir origen principal del “scroll infinito” en el preview
- En `DocxPreview`:
  - Hacer el root del preview `relative`.
  - Mover el nodo de medición fuera del área visible sin afectar scroll global (offscreen/fixed o wrapper oculto con clipping real).
  - Mantenerlo `pointer-events-none` y `aria-hidden`.
- Resultado: el contenido de medición ya no expande el documento completo.

3. Reforzar la cadena de alturas en Validación (desktop)
- En `Validacion`:
  - Mantener `h-dvh`/`h-screen` en root y asegurar `min-h-0` en cada nivel flex crítico.
  - Panel izquierdo y derecho con overflow interno explícito (no propagado al body).
  - El preview conserva scroll interno híbrido.
- Resultado: sin scroll global accidental en desktop.

4. Implementar “bloqueo flexible” por contexto
- Mantener desktop sin scroll global en Validación por defecto.
- Permitir scroll global cuando el contexto lo requiere (ej. modal abierto o páginas no split-view).
- Esto se controla por ruta/componente, no como bloqueo rígido global para toda la app.

5. Ajuste UX adicional profesional
- Añadir `overscroll-contain` en contenedores internos scrolleables para evitar “scroll chaining” al body.
- Verificar que la barra de navegación de páginas del preview siempre quede visible y estable.

Detalle técnico (resumen)
- Archivos principales:
  - `src/components/tramites/DocxPreview.tsx`
  - `src/pages/Validacion.tsx`
  - `src/index.css`
- Cambios clave:
  - Medición HTML “aislada” del flujo global.
  - Cadena `flex + min-h-0 + overflow` completa y coherente.
  - Base global robusta (`height:100%`, `overflow-x:hidden`, uso de `dvh` donde aplique).

Validación (E2E)
1. Desktop `/tramite/nuevo`:
- No debe existir scroll infinito de toda la página.
- El preview debe scrollear internamente cuando no quepa.
- El panel derecho debe mantener su propio scroll.
2. Mobile:
- Layout en columna con scroll natural.
3. Regresión global:
- Dashboard/Login/Admin sin recortes ni doble scroll inesperado.
