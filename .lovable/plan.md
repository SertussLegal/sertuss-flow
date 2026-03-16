

## Plan: Crear tabla `notaria_styles`

### Lo que ya existe (no requiere cambios)
- `tramites.is_unlocked` — ya implementado
- `tramites.metadata` (JSONB) — ya se usa para persistir datos de extracción, progreso, variables personalizadas
- `unlock_expediente` RPC — ya implementada con cobro atómico de 2 créditos

### Único cambio necesario: tabla `notaria_styles`

**Migration SQL:**

```sql
CREATE TABLE public.notaria_styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nombre_notaria text NOT NULL DEFAULT '',
  ciudad text NOT NULL DEFAULT '',
  estilo_linderos text NOT NULL DEFAULT '',
  notario_titular text NOT NULL DEFAULT '',
  clausulas_personalizadas jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id)
);

ALTER TABLE public.notaria_styles ENABLE ROW LEVEL SECURITY;

-- Solo usuarios de la misma org pueden ver
CREATE POLICY "Users can view own org styles"
  ON public.notaria_styles FOR SELECT TO authenticated
  USING (organization_id = get_user_org(auth.uid()));

-- Owner/Admin pueden insertar/actualizar
CREATE POLICY "Admins can manage styles"
  ON public.notaria_styles FOR ALL TO authenticated
  USING (organization_id = get_user_org(auth.uid()) 
    AND get_user_role(auth.uid()) IN ('owner', 'admin'))
  WITH CHECK (organization_id = get_user_org(auth.uid()) 
    AND get_user_role(auth.uid()) IN ('owner', 'admin'));
```

**Constraint `UNIQUE(organization_id)`**: Cada organización tiene un solo registro de estilos (1:1).

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| Migration SQL | Crear tabla + RLS |
| `src/lib/types.ts` | Agregar interface `NotariaStyle` |

No se requieren cambios en `tramites`, funciones RPC, ni edge functions.

