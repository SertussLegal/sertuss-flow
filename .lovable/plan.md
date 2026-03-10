

## Plan: Auto-guardado como Borrador + Sección de Borradores en Dashboard

### Resumen
Implementar auto-guardado silencioso en `Validacion.tsx` que persiste el trabajo como borrador (`pendiente`) cada 30 segundos. En el Dashboard, mostrar una sección destacada de borradores con tarjetas que incluyan título, descripción, fecha relativa, y botón "Continuar".

### 1. Auto-guardado en Validacion.tsx

- Agregar flag `isDirty` que se activa cuando cualquier dato cambia (vendedores, compradores, inmueble, actos, customVariables).
- `useEffect` con debounce de 30s: si `isDirty` es true, ejecutar guardado silencioso en background.
- Para trámites nuevos (`/tramite/nuevo`): hacer `INSERT` con status `pendiente`, obtener el `id`, y hacer `navigate(/tramite/{id}, { replace: true })` sin recargar.
- Para trámites existentes con status `pendiente`: hacer `UPDATE` silencioso.
- Indicador visual en el header: "Guardado ✓" / "Guardando..." / "Sin guardar" con iconos `Cloud`, `Loader2`, `CloudOff`.
- Remover la validación obligatoria de `identificador_predial` del auto-guardado (solo aplica al guardado manual como "validado").
- Guardar también al hacer `beforeunload` (intentar guardar antes de cerrar pestaña).

### 2. Dashboard: Sección de Borradores

Antes de la tabla principal, mostrar una sección condicional cuando existan trámites con status `pendiente`:

```text
┌─────────────────────────────────────────────────┐
│ 📝 Borradores en progreso                      │
│                                                 │
│ ┌──────────────────┐  ┌──────────────────┐      │
│ │ Compraventa      │  │ Hipoteca         │      │
│ │ Matrícula: 123.. │  │ Sin datos aún    │      │
│ │ Hace 2 horas     │  │ Hace 1 día       │      │
│ │ [Continuar →]    │  │ [Continuar →]    │      │
│ └──────────────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────┘
```

- Tarjetas con: tipo de acto (o "Nuevo trámite"), matrícula inmobiliaria si existe, fecha relativa (`formatDistanceToNow` de date-fns), y botón "Continuar".
- Separar borradores de la tabla principal: la tabla solo muestra `validado` y `word_generado`.
- Máximo 4 borradores visibles, con scroll horizontal si hay más.

### 3. Cambios por archivo

| Archivo | Cambio |
|---------|--------|
| `Validacion.tsx` | Auto-guardado con debounce 30s, `isDirty` tracking, indicador visual en header, `beforeunload`, guardado como `pendiente` |
| `Dashboard.tsx` | Sección de borradores con tarjetas, separar borradores de tabla, fecha relativa con date-fns |

No se requieren cambios de base de datos — el status `pendiente` ya existe en el enum `tramite_status` y la columna `metadata` JSONB ya almacena `custom_variables` y `last_saved`.

