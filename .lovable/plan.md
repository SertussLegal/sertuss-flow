

## Fix: Registro no crea organización + Onboarding para usuarios existentes

### Problema confirmado
El perfil de `malejaarciniegas@gmail.com` existe con `organization_id: null`, `full_name: null`, `role: operator`. La organización nunca se creó porque el código en `Login.tsx` intenta hacer `insert` en `organizations` y `update` en `profiles` justo después del `signUp`, pero como el email requiere confirmación, no hay sesión activa y RLS bloquea todo silenciosamente.

### Solución (3 partes)

**1. DB: Función `create_organization_for_user`** (SECURITY DEFINER)
- Recibe `user_id`, `org_name`, `org_nit`
- Crea la organización con 5 créditos por defecto
- Actualiza el profile con `organization_id` y `role = 'owner'`
- No depende de `auth.uid()` — funciona post-confirmación

**2. Fix `Login.tsx` — Registro**
- Después del `signUp`, guardar `org_name` y `nit` en `user_metadata` (esto SÍ funciona sin sesión)
- Eliminar los `insert`/`update` directos que fallan por RLS
- En `AuthContext`, al detectar un usuario con `organization_id = null` Y `user_metadata` con datos de org, llamar al RPC `create_organization_for_user` automáticamente
- Formato NIT: máscara de input `XXXXXXXXX-X` con validación

**3. Modal onboarding para usuarios existentes sin org (`SetupOrgModal.tsx`)**
- Se muestra en `Dashboard.tsx` cuando `profile.organization_id === null`
- Campos: Razón Social (default "Organizacion001" si se deja vacío), NIT (formato colombiano obligatorio)
- Llama al RPC `create_organization_for_user`
- Una vez completado, refresca el perfil y cierra el modal

### Archivos

| Archivo | Cambio |
|---------|--------|
| Migration SQL | Crear función `create_organization_for_user(user_id, org_name, org_nit)` |
| `src/pages/Login.tsx` | Guardar datos org en `user_metadata` en vez de DB directa; mejorar máscara NIT |
| `src/contexts/AuthContext.tsx` | Auto-crear org desde `user_metadata` si `organization_id` es null al iniciar sesión |
| `src/components/SetupOrgModal.tsx` | Nuevo modal para usuarios existentes sin organización |
| `src/pages/Dashboard.tsx` | Mostrar `SetupOrgModal` si no tiene org |

### Detalle de la función SQL

```sql
CREATE OR REPLACE FUNCTION public.create_organization_for_user(
  p_user_id uuid, p_org_name text, p_org_nit varchar
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  new_org_id uuid;
BEGIN
  INSERT INTO organizations (name, nit)
  VALUES (COALESCE(NULLIF(p_org_name, ''), 'Organizacion001'), NULLIF(p_org_nit, ''))
  RETURNING id INTO new_org_id;

  UPDATE profiles
  SET organization_id = new_org_id, role = 'owner'
  WHERE id = p_user_id;

  RETURN new_org_id;
END;
$$;
```

### Flujo corregido

```text
REGISTRO NUEVO:
  signUp(email, pass, { data: { org_name, nit } })
  → email confirmado → login
  → AuthContext detecta org_id=null + metadata.org_name
  → RPC create_organization_for_user → org creada → dashboard normal

USUARIO EXISTENTE SIN ORG (ej: malejaarciniegas):
  login → Dashboard → detecta org_id=null, no metadata
  → Muestra SetupOrgModal
  → Usuario llena datos → RPC → org creada → continúa
```

