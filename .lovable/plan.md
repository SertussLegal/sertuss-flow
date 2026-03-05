

## Reconstrucción Landing Page — SEO/GEO + Conversión

### Arquitectura de cambios

**1. `index.html` — Metadatos SEO y Schema JSON-LD**
- Cambiar `lang="en"` → `lang="es-CO"`
- Title: "Sertuss — Escrituración Inteligente en Colombia | Cero Notas Devolutivas"
- Meta description optimizada para el sector notarial colombiano
- Open Graph y Twitter Cards con datos de Sertuss
- JSON-LD inline con schemas `SoftwareApplication` + `LegalService` + `FAQPage`
- Pre-renderizado: añadir contenido semántico visible en el HTML estático dentro de `<noscript>` y texto accesible fuera del root para crawlers

**2. `src/pages/LandingPage.tsx` — Nueva página de landing (reemplaza Login en ruta `/`)**

Estructura por secciones:

- **Hero Split-Screen**: Grid 2 columnas en desktop, stack en móvil
  - Izquierda: H1 "Escrituración Inteligente en Colombia. Cero Notas Devolutivas", párrafo de dolor/solución, CTA primario ("Cargar mi primera Minuta" verde `#1b5e3b`, min 44px height) y CTA secundario ("Ver Demo" outline, abre modal de video)
  - Derecha: Ilustración/placeholder visual representando el flujo de automatización

- **Trust Signals**: Franja horizontal con íconos + texto: "Seguridad de Grado Bancario", "Cumple con SNR", "Infraestructura Google Cloud"

- **FAQ Estructurada**: Componente Accordion con 2 preguntas iniciales marcadas con `itemScope`/`itemProp` de Schema.org FAQPage:
  - "¿Cómo automatizar minutas del Banco de Bogotá?"
  - "¿Cómo evitar errores de registro en escrituras?"

- **Sección Login/Registro**: Card de autenticación (se conserva la lógica actual de Supabase Auth)

- **Footer Legal**: Links a "Política de Tratamiento de Datos (Habeas Data)", "Términos de Servicio", copyright

**3. `src/components/landing/DemoModal.tsx`**
- Dialog con placeholder de video (iframe o imagen) para el CTA "Ver Demo"

**4. `src/App.tsx`**
- Ruta `/` apunta a `LandingPage`
- Ruta `/login` apunta a `Login` (para acceso directo)

**5. Accesibilidad WCAG 2.1 AA**
- Todos los botones CTA con `min-h-[44px] min-w-[44px]`
- Contraste verificado en la paleta azul/verde sobre fondos oscuros
- Atributos `aria-label` en elementos interactivos
- Estructura semántica: `<header>`, `<main>`, `<section>`, `<footer>`

**6. Rendimiento**
- Componentes ligeros de shadcn/ui (Button, Card, Accordion, Dialog)
- Sin imágenes pesadas en el hero (íconos SVG de Lucide)
- Lazy load del modal de video
- Nota: SSR real no es posible en Vite/React SPA; se compensa con contenido semántico en `index.html` y JSON-LD estático para crawlers de IA

