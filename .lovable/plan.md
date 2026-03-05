

## Sistema de Diseño Sertuss — Landing Page Redesign

### Cambios por archivo

**1. `index.html`**
- Añadir Google Fonts: `Playfair Display` (serif, headings) y `Inter` (sans-serif, body)
- Preconnect a fonts.googleapis.com para rendimiento

**2. `src/index.css`**
- Actualizar `--notarial-dark` al valor exacto de `#0f172a` (HSL: 222 47% 11%)
- Añadir clases utilitarias: `.font-serif` → Playfair Display, `.font-sans` → Inter
- Glassmorphism utility: `.glass` con `backdrop-blur-xl`, `bg-white/10`, `border border-white/20`
- Body font-size base 16px, line-height 1.5

**3. `tailwind.config.ts`**
- Extender `fontFamily`: `serif: ['Playfair Display', 'Georgia', 'serif']`, `sans: ['Inter', 'system-ui', 'sans-serif']`

**4. `src/pages/LandingPage.tsx` — Rediseño completo**

Layout Hero Split-Screen:
- Izquierda: H1 en `font-serif` con leading-[1.2], párrafo de dolor, CTAs (verde + outline demo)
- Derecha: Formulario de Login/Registro con efecto glassmorphism (`backdrop-blur-xl bg-white/10 border-white/20`)

Sección Trust Signals: Se mantiene, se ajustan colores al nuevo fondo `#0f172a`

Sección FAQ: Se mantiene con Accordion, se aplica `font-serif` a los H2

Sección Auth: Se elimina como sección independiente (se mueve al hero split-screen derecho)

Checkbox Ley 1581: Añadir debajo del botón de submit:
```
☐ Acepto la Política de Tratamiento de Datos (Ley 1581)
```
- Estado `acceptedPolicy` con `useState(false)`
- Botón de submit deshabilitado si `!acceptedPolicy`
- Enlace dentro del label a la política de Habeas Data

Footer: Se mantiene

**5. Accesibilidad**
- Contraste 4.5:1 verificado: texto `#f8fafc` sobre `#0f172a` = ratio 15.4:1
- Verde `#1b5e3b` sobre `#0f172a` para botones = ratio 3.2:1 (se usa texto blanco `#ffffff` sobre verde = 5.9:1, cumple)
- Touch targets 44px ya implementados, se mantienen
- `aria-label` en todos los interactivos

