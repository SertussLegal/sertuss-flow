## "Elevated Cloud Productivity" — Sertuss Landing Refinement

### 1. `src/index.css`

- Update `--notarial-dark` to `222 84% 5%` (`#020617`)
- Update `.glass` utility: `backdrop-blur-2xl`, `bg-white/5`, `border-white/10`
- Add `.bg-gradient-dark` utility with a diagonal linear gradient from `#020617` to a subtle emerald-tinted navy (`#041525` via `#064e3b` at 5% opacity blend), creating depth without noise

### 2. `src/pages/LandingPage.tsx`

**Background**: Replace `bg-notarial-dark` on root div with the new gradient class

**Header button**: Update to ghost style with `border-white/20 text-white hover:bg-white/10`

**Hero copy** (already correct, no changes needed to H1/subheadline/CTA text)

**Glassmorphism card**: Replace `glass` with explicit `backdrop-blur-2xl bg-white/[0.05] border border-white/10 rounded-2xl shadow-2xl` (24px corners). Remove Card component wrapper, use raw div for full control over border-radius

**Form inputs**: Keep `h-12` (48px). Change input background from `bg-notarial-light` to `bg-white/10 text-white placeholder:text-slate-400 border-white/10` for cohesion with glass aesthetic

**Buttons**: Primary CTA add `shadow-lg shadow-emerald-500/20` for glow. Rounded to `rounded-lg` (8px)

**Checkbox/Legal text**: Change `text-muted-foreground` to `text-white` on policy label. Checkbox border to `border-white`

**Trust signals text**: Update to "Seguridad Institucional", "Alineado con estándares SNR", "Infraestructura de Alta Disponibilidad"

**Demo button**: Update to `border-white/20 text-white hover:bg-white/10`

**FAQ section**: Keep `bg-white/[0.02]` differentiated background. Accordion item backgrounds to `bg-white/[0.03]`. Answer text stays concise (already ~50 words)

**Footer**: Keep `text-slate-400` (already readable)

### 3. `tailwind.config.ts`

No changes needed (Inter sans-serif already unified, animations already present)

### Files modified

- `src/index.css` — gradient utility, glass update, dark color token
- `src/pages/LandingPage.tsx` — visual refinements across all sections  


aplica los cambios de texto positivo en el Hero (Agilidad y Precisión) y asegúrate de que todos los textos pequeños del footer y labels sean blanco puro (#FFFFFF) para máxima legibilidad.