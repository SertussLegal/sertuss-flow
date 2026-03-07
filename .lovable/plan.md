

## Audit Report: Sertuss Implementation Status

After a thorough review of the database schema, triggers, foreign keys, RLS policies, edge function, and frontend code, here is the current state and the fixes needed.

---

### What's Already Working

| Component | Status |
|-----------|--------|
| All 7 tables (organizations, profiles, tramites, personas, inmuebles, actos, activity_logs, invitations) | Created with correct columns |
| Foreign keys (11 total) across all tables | Correctly configured |
| `consume_credit` RPC with `credit_balance` (default 5) | Working |
| `handle_new_user` trigger on auth.users | Exists and fires |
| `log_word_generated` trigger on tramites | Exists and fires |
| `get_user_org` / `get_user_role` helper functions | Working |
| RLS policies on all tables | All PERMISSIVE, correctly scoped |
| Edge function `generate-document` code | Deployed, uses Gemini 3 Flash |
| Auth flow (login/register), Dashboard, Team page | Implemented |
| Credit display + disable when 0 | Working |

---

### Issues Found (3 Critical, 1 Medium)

#### CRITICAL 1: Missing INSERT Policy on `organizations`

The registration flow in `Login.tsx` creates an organization via `.insert()`, but the `organizations` table has **no INSERT policy**. This means registration will fail with an RLS error for every new user.

**Fix:** Add an INSERT policy allowing authenticated users to create organizations.

#### CRITICAL 2: Missing Edge Function Config in `config.toml`

The `supabase/config.toml` only contains `project_id`. Without a `[functions.generate-document]` section with `verify_jwt = false`, the edge function may reject requests or fail to deploy correctly.

**Fix:** Add function configuration to `config.toml`.

#### CRITICAL 3: Frontend Data Mapping Bug in `Validacion.tsx`

The edge function returns `{ templateData: {...} }`, but line 156-160 in `Validacion.tsx` does `Object.entries(enrichedData)` directly. This means `safeData` will be `{ templateData: "[object Object]" }` instead of the actual template fields. The `.docx` generation will produce a broken document.

**Fix:** Use `enrichedData.templateData` instead of `enrichedData`.

#### MEDIUM: Duplicate Audit Log Entry

Both the `log_word_generated` trigger (fires when status changes to `word_generado`) AND the explicit `activity_logs.insert()` on line 179 of `Validacion.tsx` create audit entries. This results in **two** audit log rows per document generation. The trigger uses action `'generated'`, the frontend uses `'word_generated'`.

**Fix:** Remove the explicit frontend insert since the trigger handles it automatically. This is cleaner and tamper-proof.

---

### Implementation Plan

**Migration (1 SQL migration):**
1. Add INSERT policy on `organizations` for authenticated users

**File changes:**

| File | Change |
|------|--------|
| `supabase/config.toml` | Add `[functions.generate-document]` with `verify_jwt = false` |
| `src/pages/Validacion.tsx` | Fix `enrichedData` → `enrichedData.templateData`; remove duplicate audit log insert |

Total: 1 migration + 2 file edits. No new tables or functions needed.

