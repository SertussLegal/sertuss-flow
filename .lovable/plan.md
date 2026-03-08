

## Admin Panel with Audit Trail, Adjustment Reason, and Status Badges

### Database Migration

**1. `get_all_organizations()` function** — SECURITY DEFINER, checks caller is `owner`, returns all orgs.

**2. `admin_update_credits(target_org_id uuid, new_balance int, reason text)` function** — SECURITY DEFINER:
- Checks caller is `owner`
- Updates `organizations.credit_balance`
- Inserts into `activity_logs` with `action = 'CREDIT_UPDATE'`, `entity_type = 'organization'`, `entity_id = target_org_id`, `metadata = { old_balance, new_balance, reason }`
- Uses caller's `organization_id` and `auth.uid()` for the log entry

```sql
CREATE OR REPLACE FUNCTION public.get_all_organizations()
RETURNS TABLE(id uuid, name text, nit varchar, address text, credit_balance int, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY SELECT o.id, o.name, o.nit, o.address, o.credit_balance, o.created_at FROM organizations o ORDER BY o.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_credits(target_org_id uuid, new_balance int, reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  old_bal int;
  caller_org uuid;
BEGIN
  IF get_user_role(auth.uid()) != 'owner' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT credit_balance INTO old_bal FROM organizations WHERE id = target_org_id;
  UPDATE organizations SET credit_balance = new_balance WHERE id = target_org_id;
  caller_org := get_user_org(auth.uid());
  INSERT INTO activity_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (caller_org, auth.uid(), 'CREDIT_UPDATE', 'organization', target_org_id,
    jsonb_build_object('old_balance', old_bal, 'new_balance', new_balance, 'reason', reason));
END;
$$;
```

### New File: `src/pages/Admin.tsx`

Full admin panel with:

- **Access guard**: Redirects to `/dashboard` if `profile?.role !== 'owner'`
- **Header**: Same `bg-notarial-dark` style as Dashboard, with back button and "Panel de Administración" title
- **Stats row**: Two cards — "Total Organizaciones" (count) and "Créditos en Circulación" (sum of all balances)
- **Search filter**: Input filtering by org name or NIT
- **Organizations table** with columns:
  - Nombre, NIT, Créditos, **Estado** (Badge), Acciones
  - **Estado Badge logic**:
    - `credit_balance > 5` → green Badge "Activo"
    - `1 <= credit_balance <= 5` → yellow Badge "Créditos Bajos"
    - `credit_balance === 0` → red Badge "Agotado"
- **Edit Credits Dialog**:
  - Number input for new balance
  - **Required text input** "Motivo del Ajuste" (placeholder: "Ej: Compra de paquete 100")
  - Confirm button disabled until reason is provided
  - Calls `admin_update_credits` RPC with `target_org_id`, `new_balance`, `reason`
  - Toast on success, refresh list

### Modified Files

**`src/App.tsx`** — Add `/admin` route as `<ProtectedRoute><Admin /></ProtectedRoute>`

**`src/pages/Dashboard.tsx`** — Add "Admin" button in header, visible only when `profile?.role === 'owner'`:
```tsx
{profile?.role === "owner" && (
  <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="text-white hover:bg-white/10">
    <Shield className="mr-1 h-4 w-4" /> Admin
  </Button>
)}
```

### Files Summary

| File | Action |
|------|--------|
| Migration SQL | Create 2 SECURITY DEFINER functions |
| `src/pages/Admin.tsx` | New — full admin panel |
| `src/App.tsx` | Add `/admin` route |
| `src/pages/Dashboard.tsx` | Add Admin nav button for owners |

