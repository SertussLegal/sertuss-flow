

## Fix: Ghost Button Hover Text Unreadable on Dark Backgrounds

### Problem
The `ghost` variant in `button.tsx` applies `hover:text-accent-foreground` on hover. On dark headers (`bg-notarial-dark`), the accent-foreground resolves to a dark color, making text illegible even though buttons have `text-white` as a className override.

### Solution
The project already has a `ghost-dark` variant but it includes borders (`border border-white/20 bg-white/10`) which gives it a different visual weight. The cleanest fix:

**Update the `ghost` variant** to not force a text color on hover — only change the background. This makes it more composable: the text color stays whatever the consumer sets.

```
ghost: "hover:bg-accent hover:text-accent-foreground"
  ↓
ghost: "hover:bg-accent/80"
```

Wait — this would break ghost buttons on light backgrounds where `hover:text-accent-foreground` is needed. Better approach:

**Add a dedicated `ghost` behavior for dark contexts** by simply adding `hover:text-white` to the className of all these dark-header buttons. But this is fragile and repetitive.

**Best approach**: Keep `ghost` as-is for light contexts. Update all dark-header nav buttons to use the existing `ghost-dark` variant but **remove the border and background** from `ghost-dark` to make it a true ghost on dark surfaces:

```
"ghost-dark": "text-white hover:bg-white/[0.15] hover:text-white"
```

This removes the visible border/bg that currently makes `ghost-dark` look like a bordered button, turning it into the correct dark-surface ghost. All 7 instances across 4 files switch from `variant="ghost" className="text-white hover:bg-white/10"` to `variant="ghost-dark"` with no extra className needed.

### Changes

**`src/components/ui/button.tsx`** — Update ghost-dark variant:
```
"ghost-dark": "text-white hover:bg-white/[0.15] hover:text-white"
```

**4 page files** — Replace `variant="ghost" ... className="text-white hover:bg-white/10"` with `variant="ghost-dark"` (remove redundant className):
- `src/pages/Dashboard.tsx` — 3 buttons (Admin, Equipo, Salir)
- `src/pages/Admin.tsx` — 1 button (Dashboard)
- `src/pages/Team.tsx` — 1 button (Dashboard)
- `src/pages/Validacion.tsx` — 1 button (Dashboard)

