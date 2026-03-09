

## Sertuss — Multi-tenant Architecture with Organizations, Credits, and Audit Trail

This is a large backend-first implementation. The plan is divided into database schema, backend logic, and frontend integration.

---

### Phase 1: Database Schema (Single Migration)

**Tables to create:**

1. **`organizations`** — Multi-tenant root
   - `id` uuid PK, `name` text NOT NULL, `nit` varchar(20), `address` text, `credit_balance` integer DEFAULT 5, `created_at` timestamptz

2. **`profiles`** — Extends auth.users
   - `id` uuid PK (references auth.users), `email` text, `full_name` text, `organization_id` uuid FK → organizations, `role` org_role enum ('owner','admin','operator'), `created_at` timestamptz
   - Trigger on `auth.users` insert to auto-create profile row

3. **`tramites`** — Core business entity
   - `id` uuid PK, `radicado` text, `tipo` text, `fecha` date, `status` tramite_status enum ('pendiente','validado','word_generado'), `organization_id` uuid FK, `created_by` uuid FK → profiles, `created_at`, `updated_at`

4. **`personas`** — Vendedores/Compradores linked to tramite
   - `id` uuid PK, `tramite_id` uuid FK, `rol` persona_rol enum ('vendedor','comprador'), all existing Persona fields including `nit` varchar(20), `es_persona_juridica`, `es_pep`, etc.

5. **`inmuebles`** — One per tramite
   - `id` uuid PK, `tramite_id` uuid FK, all Inmueble fields. `identificador_predial` varchar(30) to support 30-digit Nacional.

6. **`actos`** — One per tramite
   - `id` uuid PK, `tramite_id` uuid FK, all Actos fields.

7. **`activity_logs`** — Habeas Data / Ley 1581 audit trail
   - `id` uuid PK, `organization_id` uuid FK, `user_id` uuid FK, `action` text ('created','updated','generated','viewed'), `entity_type` text ('tramite','persona','inmueble'), `entity_id` uuid, `metadata` jsonb, `created_at` timestamptz

8. **`invitations`** — Team invite infrastructure
   - `id` uuid PK, `organization_id` uuid FK, `email` text, `role` org_role, `invited_by` uuid FK, `accepted_at` timestamptz NULL, `created_at` timestamptz

**Enums:**
- `org_role`: 'owner', 'admin', 'operator'
- `tramite_status`: 'pendiente', 'validado', 'word_generado'
- `persona_rol`: 'vendedor', 'comprador'

---

### Phase 2: RLS Policies

All business tables scoped by `organization_id` via a helper function:

```text
get_user_org(uid) → returns organization_id from profiles
get_user_role(uid) → returns role from profiles
```

- **organizations**: Users can SELECT their own org. Owners can UPDATE.
- **profiles**: Users in same org can SELECT each other. Admins/Owners can UPDATE roles.
- **tramites**: SELECT/INSERT/UPDATE scoped to org. Operators can only see `created_by = auth.uid()`.
- **personas, inmuebles, actos**: Access via tramite ownership (join through tramites table).
- **activity_logs**: INSERT for authenticated users in their org. SELECT for admin/owner only.
- **invitations**: Admin/Owner can INSERT/SELECT for their org.

---

### Phase 3: Credit Consumption Function

Database function `consume_credit(org_id uuid)`:
- Checks `credit_balance > 0`, decrements by 1, returns success/failure.
- Called from frontend before setting status to `word_generado`.
- SECURITY DEFINER to bypass RLS.

Database trigger on `tramites` UPDATE: when status changes to `word_generado`, automatically log to `activity_logs`.

---

### Phase 4: Frontend Changes

1. **Auth flow update** (`Login.tsx`):
   - On registration, create organization + profile with role 'owner'.
   - On login, fetch profile to get org_id and role, store in React context.

2. **Auth context** (`src/contexts/AuthContext.tsx`):
   - Provides `user`, `profile`, `organization`, `credits` to the app.
   - Protected route wrapper redirects unauthenticated users.

3. **Dashboard.tsx**:
   - Replace mock data with real Supabase queries scoped by org.
   - Show credit balance in header.
   - Disable "Nuevo Trámite" if credits = 0 with warning message.

4. **Validacion.tsx**:
   - Save tramite + personas + inmueble + actos to database.
   - On "Generate Word", call `consume_credit`, update status, log activity.
   - If credits = 0, disable generate button with "Bolsa de créditos agotada" message.

5. **Team Management page** (`src/pages/Team.tsx`):
   - List org members with roles.
   - Invite form (email + role).
   - Admin can change roles.
   - Credit consumption per user (query activity_logs grouped by user).

6. **New route**: `/equipo` → Team.tsx

7. **Types update** (`src/lib/types.ts`):
   - Add Organization, Profile, ActivityLog, Invitation interfaces.
   - Keep existing interfaces for form compatibility.

---

### Files to create/modify

| File | Action |
|------|--------|
| Migration SQL | Create all tables, enums, RLS, functions, triggers |
| `src/contexts/AuthContext.tsx` | New — auth + org context provider |
| `src/pages/Team.tsx` | New — team management UI |
| `src/lib/types.ts` | Add Organization, Profile, Invitation, ActivityLog types |
| `src/App.tsx` | Add AuthProvider wrapper, protected routes, `/equipo` route |
| `src/pages/Login.tsx` | Create org on register, redirect on login |
| `src/pages/Dashboard.tsx` | Real queries, credit display, disable if 0 |
| `src/pages/Validacion.tsx` | Persist to DB, credit consumption on generate |
| `src/pages/LandingPage.tsx` | **No changes** — visual styles preserved |
| `src/index.css` | **No changes** |


## Generate Word Document with Gemini AI (IMPLEMENTED)

### Architecture
Frontend → consume_credit RPC → generate-document edge function (Gemini AI) → docxtemplater fill → browser download → update status to word_generado

### Implemented
- Edge function `supabase/functions/generate-document/index.ts` with Lovable AI Gateway (Gemini 3 Flash)
- Tool calling for structured JSON extraction of legal template fields
- `docxtemplater` + `pizzip` for client-side .docx generation
- Auto-download with tramite name
- Credit validation before generation
- Status update triggers activity log
- Loading state in PreviewModal during generation
