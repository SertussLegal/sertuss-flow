

## Terminology Refinement + Legal Data Form + NIT/Name Blocking

### 1. Admin.tsx — Label Changes (identity labels only)

- Table column header: `Nombre` → `Razón Social`
- Search placeholder: `Buscar por nombre o NIT...` → `Buscar por razón social o NIT...`
- Modal title: `Editar Créditos — {editOrg?.name}` → `Editar Créditos — Razón Social de la Entidad: {editOrg?.name}`
- Modal description: `...para esta organización` → `...para esta entidad`

### 2. Login.tsx — Registration "Datos Legales" Section

Replace the single "Nombre de la Organización / Notaría" field with two fields when `isRegister`:

- **Razón Social** — `<Input>` text, required, placeholder: `Nombre legal de la Notaría, Firma o Empresa`
- **NIT** — `<Input>` text, required, placeholder: `000000000-0`, with regex validation `^\d{9}-\d{1}$` on submit

Group them under a `<p>` label "Datos Legales" for visual separation.

On registration, insert `{ name: orgName.trim(), nit: nit.trim() }` into `organizations`.

### 3. Credit Blocking Logic — Validate `nit` + `name` Before AI Generation

In `src/pages/Validacion.tsx`, before calling `consume_credit`, check `organization.nit` and `organization.name` from AuthContext. If either is null/empty, show a toast error and block generation.

In `src/pages/Dashboard.tsx`, extend the existing `credits === 0` disabled condition on "Nuevo Trámite" to also check if `organization?.nit` and `organization?.name` are missing, showing a warning message.

### 4. AuthContext — Expose `organization` (already done)

The `organization` object with `nit` and `name` is already available via `useAuth()`. No changes needed.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Admin.tsx` | Column header + modal label updates |
| `src/pages/Login.tsx` | Add NIT field with format validation, rename org label |
| `src/pages/Validacion.tsx` | Add nit/name check before `consume_credit` |
| `src/pages/Dashboard.tsx` | Add nit/name check to disable "Nuevo Trámite" + warning |

