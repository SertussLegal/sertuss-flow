

## "Cloud Productivity" — Final Polish

Most of the requested design is already in place. Here are the remaining deltas:

### 1. `src/index.css`
- **Gradient**: Already exists but uses `#041525` as midpoint. No change needed — it already blends `#020617` with emerald-tinted navy subtly.
- **Glass utility**: Already `backdrop-blur-2xl`. Keep as-is (Tailwind doesn't have `blur-3xl` by default).

### 2. `src/pages/LandingPage.tsx`

**Already correct** (no changes needed):
- H1 text, subheadline, CTA "Empezar ahora"
- Header button ghost style with `border-white/20 text-white hover:bg-white/10`
- Glassmorphism card with `backdrop-blur-2xl bg-white/[0.05] border-white/10 rounded-2xl`
- Inputs at `h-12` (48px) with `bg-white/10`
- Checkbox in white, policy text in white
- Trust signals: "Seguridad Institucional", "Alineado con estándares SNR"

**Changes needed:**

1. **Subheadline update**: Change "...con la velocidad y exactitud que el sector exige." to "...para procesar minutas con la máxima velocidad."

2. **Trust signal #3**: Change "Infraestructura de Alta Disponibilidad" to "Cifrado de Grado Bancario". Change icon from `Cloud` to `Shield` (or keep `Lock`).

3. **Glassmorphism card**: Upgrade `rounded-2xl` to `rounded-3xl` (24px) per request.

4. **FAQ accordion item #1**: Change `border-border/30 bg-card/10` to `border-white/10 bg-white/[0.03]` for consistency with item #2.

5. **FAQ answer text**: Change `text-muted-foreground` to `text-slate-300` for better contrast on dark background.

6. **Footer links**: Change `text-slate-400` to `text-slate-300` for improved legibility.

### 3. No changes to `tailwind.config.ts` or `src/index.css`

### Files modified
- `src/pages/LandingPage.tsx` — 6 small targeted edits

