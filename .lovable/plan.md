

## Configuración de Entidad — Página accesible desde Admin

### Approach

Add a new route `/admin/entidad/:id` with a form to edit an organization's Razón Social, NIT, and Dirección. Accessible from the Admin table via a new button per row. Only `owner` role can access.

Since the existing RLS policy `Owners can update org` only allows updating the user's **own** org, we need a new `SECURITY DEFINER` function `admin_update_organization` that lets the platform owner update any org's identity fields.

### Changes

**1. Database migration** — New function `admin_update_organization`:
```sql
CREATE OR REPLACE FUNCTION public.admin_update_organization(
  target_org_id uuid, new_name text, new_nit varchar, new_address text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE organizations
  SET name = new_name, nit = new_nit, address = new_address
  WHERE id = target_org_id;
END;
$$;
```

**2. New page `src/pages/AdminOrgEdit.tsx`**:
- Receives org ID from route params
- Fetches org data via `get_all_organizations` (already available), filters by ID
- Form with 3 fields: Razón Social (required), NIT (validated `^\d{9}-\d{1}$`), Dirección (optional)
- Saves via `admin_update_organization` RPC
- Same dark header style as Admin page
- Back button returns to `/admin`

**3. Update `src/pages/Admin.tsx`**:
- Add a "Configurar" button (Settings icon) next to "Editar Créditos" in each row, linking to `/admin/entidad/:id`

**4. Update `src/App.tsx`**:
- Add route `/admin/entidad/:id` → `<ProtectedRoute><AdminOrgEdit /></ProtectedRoute>`

### Files
| File | Action |
|------|--------|
| Migration SQL | New `admin_update_organization` function |
| `src/pages/AdminOrgEdit.tsx` | New page — org config form |
| `src/pages/Admin.tsx` | Add "Configurar" button per row |
| `src/App.tsx` | Add new route |

