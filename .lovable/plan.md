

## Evolución "Productivity Cloud" — Sertuss Landing

### Cambios por archivo

**1. `src/index.css`**
- Actualizar `--notarial-dark` de `222 71% 4%` a `222 47% 11%` (azul pizarra profundo, ~`#0f172a`)
- Actualizar `--muted-foreground` a un gris más claro (`215 20% 65%`) para mejor legibilidad
- Actualizar `.glass`: `backdrop-blur-xl`, `bg-white/5`, `border-white/20` (glassmorphism avanzado)
- Añadir keyframes `fade-in-up` y clase `animate-fade-in-up` para animación de entrada del hero

**2. `tailwind.config.ts`**
- Añadir keyframe `fade-in-up` y animation en `extend`
- Confirmar fontFamily sans unified (ya está Inter)

**3. `src/pages/LandingPage.tsx` — Rediseño completo**

Copy:
- H1: "Agilidad y Precisión en tu Operación Notarial." (sin span verde, todo `text-notarial-light`)
- Subheadline: El texto propositivo proporcionado
- CTA primario: "Empezar ahora" (reemplaza "Cargar mi primera Minuta")
- CTA secundario: "Ver Demo" se mantiene

Layout y UX:
- Hero gap aumentado: `lg:gap-24` (de `lg:gap-20`)
- Inputs: añadir `h-12` (48px height) a todos los campos del formulario
- Header "Iniciar Sesión" botón: añadir `border border-white/20 text-slate-200` para visibilidad
- Textos pequeños (header, labels, footer): usar `text-slate-200` / `text-slate-300` (#f1f5f9 / #cbd5e1)
- Animación: envolver hero left en `animate-fade-in-up` con delay staggered

FAQ:
- Sección con fondo diferenciado: `bg-white/[0.02]` para separación visual
- Respuestas reescritas con enfoque en beneficio (max 50 palabras):
  - Q1: "Sertuss integra algoritmos que extraen datos de pagarés, instrucciones y certificados del Banco de Bogotá en segundos. El abogado se enfoca en la validación jurídica mientras el sistema genera la minuta en Word lista para firma."
  - Q2: "El motor de validación cruza matrícula, linderos, CHIP y datos de las partes contra el certificado de tradición en tiempo real. Detecta inconsistencias antes de la escritura, eliminando notas devolutivas de la ORIP."

Footer:
- Textos a `text-slate-400` para mejor contraste

