

## Rediseño "Elevated Corporate Tech" — Landing Sertuss

### Cambios por archivo

**1. `index.html`**
- Reemplazar Playfair Display + Inter por **Geist Sans** (via CDN o fallback a Inter que ya está cargado — Geist no tiene Google Fonts oficial, se mantiene Inter como equivalente disponible)
- JSON-LD y meta tags se mantienen intactos

**2. `src/index.css`**
- Actualizar `--notarial-dark` a `#020617` (HSL: 222 71% 4%)
- Actualizar `--notarial-green` a `#10b981` (HSL: 160 84% 39%)
- Glassmorphism `.glass`: cambiar a `backdrop-blur-md`, `bg-white/5`, `border-white/10`
- Body base: font-size 16px, line-height 1.5 (ya implementado)

**3. `tailwind.config.ts`**
- Cambiar `fontFamily.serif` y `fontFamily.sans` ambos a `['Inter', 'system-ui', 'sans-serif']` (unified sans-serif approach)

**4. `src/pages/LandingPage.tsx` — Rediseño visual completo**

Cambios principales:
- **H1**: Eliminar `font-serif`, usar `text-[4.5rem] font-semibold leading-[1.2]` (72px, weight 600) en desktop, responsive down a `text-4xl` en móvil
- **Fondo**: `bg-[#020617]` via la variable CSS actualizada
- **Botones primarios**: `bg-emerald-500 text-white hover:bg-emerald-400` con padding `py-4 px-8` (16px/32px)
- **Hero section**: Aumentar padding a `py-32` (128px vertical spacing)
- **Trust signals section**: Aumentar `py-20` con `mt-32` gap
- **FAQ section**: Aumentar `py-32`, eliminar `font-serif` de triggers, truncar respuestas a ~50 palabras
- **Glassmorphism card**: `backdrop-blur-md bg-white/5 border border-white/10 shadow-lg`
- **Dorado** (`#fbbf24`): restringir solo a logo Scale icon e íconos de seguridad (Lock); quitar de links de política
- **FAQ accordion triggers**: Cambiar a sans-serif, mantener microdata Schema.org
- **Checkbox y legal compliance**: Ya implementado, se mantiene

**5. Accesibilidad**
- Contraste `#f8fafc` sobre `#020617` = ~18:1 (cumple AA)
- `#10b981` texto blanco sobre botón = 3.9:1 (borderline; se usará texto `#020617` oscuro sobre verde para cumplir 4.5:1, o se mantiene blanco con font-weight 600 que es aceptable para large text)
- Touch targets 44px mantenidos via `min-h-[44px]`

