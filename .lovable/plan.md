

## Plan: Radicado híbrido (auto + editable) por organización

### Formato
`YYYY-NNNN` por organización. Ej: `2026-0001`, `2026-0002`. El consecutivo reinicia cada año.

### Cambios en BD (migración)

**1. Tabla contador por organización + año**
```sql
CREATE TABLE radicado_counters (
  organization_id uuid NOT NULL,
  year int NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, year)
);
ALTER TABLE radicado_counters ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo accesible vía SECURITY DEFINER function.
```

**2. Función SECURITY DEFINER con bloqueo (evita duplicados en concurrencia)**
```sql
CREATE FUNCTION next_radicado(p_org_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_year int := EXTRACT(YEAR FROM now());
  next_num int;
BEGIN
  INSERT INTO radicado_counters (organization_id, year, last_number)
  VALUES (p_org_id, current_year, 1)
  ON CONFLICT (organization_id, year)
  DO UPDATE SET last_number = radicado_counters.last_number + 1
  RETURNING last_number INTO next_num;
  RETURN current_year || '-' || LPAD(next_num::text, 4, '0');
END; $$;
```

**3. Trigger `BEFORE INSERT` en `tramites`**
Asigna `radicado` solo si viene NULL/vacío (permite override manual al crear).

### Cambios en UI

**Dashboard.tsx (línea ~245)**
La columna ya muestra `t.radicado ?? "—"`. Tras la migración mostrará automáticamente `2026-0001`, etc.

**Validacion.tsx (detalle del trámite)**
Agregar input editable "Radicado" en el header del detalle, con botón guardar. UPDATE directo a `tramites.radicado` (RLS ya lo permite).

### Backfill
Asignar radicado a trámites existentes que tengan `radicado IS NULL`, ordenados por `created_at` agrupados por organización + año de creación.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| Migración SQL nueva | Tabla `radicado_counters`, función `next_radicado`, trigger, backfill |
| `src/pages/Validacion.tsx` | Input editable de radicado en header |

### Riesgos
Mínimos. La función con `ON CONFLICT ... DO UPDATE ... RETURNING` es atómica y a prueba de concurrencia. El trigger respeta valores manuales.

