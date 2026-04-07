

## Plan: Rediseño UX del Expediente Sidebar — Scroll, Jerarquía y Paleta Notarial

### Problemas detectados

1. **Scroll cortado**: `SheetContent` tiene un `SheetHeader` fijo ("Documentos Cargados") + el sidebar tiene su propio header ("Expediente del Trámite") = doble cabecera que roba ~100px. El `ScrollArea` con `flex-1` sin `min-h-0` no calcula correctamente la altura restante.

2. **Header duplicado**: El Sheet dice "Documentos Cargados" y el sidebar repite "Expediente del Trámite".

3. **Colores fuera de paleta**: Usa `bg-green-50`, `bg-amber-50`, `bg-red-50` genéricos en vez de la paleta notarial (`notarial-dark`, `notarial-gold`, `notarial-green`, `notarial-blue`).

4. **Badges redundantes**: Icono verde + fondo verde + badge "Procesado" = triple señal para lo mismo.

5. **Botones "Reemplazar" y "Eliminar" demasiado prominentes**: Ocupan una fila completa por cada documento, desperdiciando espacio vertical.

### Solución

#### Archivo 1: `src/pages/Validacion.tsx` — Eliminar SheetHeader redundante

Quitar el `<SheetHeader>` con `<SheetTitle>` del Sheet (líneas 1982-1984). El sidebar absorbe el título. El `SheetContent` queda solo con el sidebar, maximizando espacio vertical.

```text
Antes:                          Después:
┌─ SheetContent ──────┐        ┌─ SheetContent ──────┐
│ SheetHeader          │        │                     │
│  "Documentos Cargados"│       │ ExpedienteSidebar   │
│ ExpedienteSidebar    │        │  (con header propio) │
│  Header propio       │        │                     │
│  ScrollArea (cortado)│        │  ScrollArea (full)   │
└─────────────────────┘        └─────────────────────┘
```

#### Archivo 2: `src/components/tramites/ExpedienteSidebar.tsx` — Rediseño completo

**A. Header unificado con paleta notarial:**
- Fondo `bg-notarial-dark text-white` (igual que el header principal de la página)
- Título: "Documentos Cargados" (absorbe el título del Sheet)
- Subtítulo con contador: "3/5 procesados"
- Barra de progreso sutil con `bg-notarial-gold`

**B. Cards de documentos — diseño limpio y compacto:**
- Eliminar fondos de colores genéricos (`bg-green-50`, etc.)
- Usar fondo neutro `bg-card` con borde izquierdo de 3px como indicador de estado:
  - Procesado: `border-l-notarial-green`
  - Pendiente: `border-l-notarial-gold`
  - Error: `border-l-destructive`
- Eliminar badges "Procesado"/"Pendiente" — el borde de color + icono ya comunican el estado
- Icono de estado: `CheckCircle` (14px, notarial-green), `Clock` (14px, notarial-gold)

**C. Acciones compactas en línea (no en fila separada):**
- Mover `RefreshCw` y `Trash2` al extremo derecho de la primera fila del card (junto al icono de estado)
- Tamaño: 14px, color `muted-foreground`, hover con opacidad
- Eliminar la fila separada de botones "Reemplazar" con texto — solo iconos
- Esto ahorra ~28px por documento procesado

**D. Botón "Subir documento" para pendientes:**
- Estilo: `border-dashed border-notarial-gold/50 text-notarial-gold hover:bg-notarial-gold/10`
- Consistente con el botón "+ Agregar Cédula"

**E. Sección "+ Agregar Cédula":**
- Estilo: `border-dashed border-notarial-gold/50 text-notarial-gold`

**F. Toggles opcionales:**
- Labels con `text-sm` (no `text-xs`) para mejor legibilidad
- Switch con color `data-[state=checked]:bg-notarial-green`

**G. Scroll fix:**
- Root: `h-full flex flex-col`
- Header: `shrink-0`
- ScrollArea: `flex-1 min-h-0` — el `min-h-0` es la clave para que flexbox calcule correctamente

### Resultado visual esperado

```text
┌─────────────────────────────┐
│ ██ Documentos Cargados      │  ← bg-notarial-dark
│    3/5 procesados [===--]   │  ← barra dorada
├─────────────────────────────┤
│ DOCUMENTOS OBLIGATORIOS     │
│                             │
│ ▎✓ Cert. Tradición    ↻ 🗑  │  ← borde verde, iconos sutiles
│ ▎  cert_tradicion.pdf       │
│                             │
│ ▎✓ Predial            ↻ 🗑  │
│ ▎  predial.jpg              │
│                             │
│ ▎⏳ Escritura Antecedente   │  ← borde dorado
│ ▎  [--- Subir documento ---]│  ← dashed dorado
│                             │
│ ─────────────────────────── │
│ CÉDULAS DE IDENTIDAD        │
│                             │
│ ▎✓ JOHN MIGUEL MAYA   ↻ 🗑  │
│ ▎  CC 79681841              │
│                             │
│ [--- + Agregar Cédula ---]  │
│                             │
│ ─────────────────────────── │
│ DOCUMENTOS OPCIONALES       │
│                             │
│ ¿Crédito Hipotecario?  [○] │
│ ¿Tiene Apoderado?      [○] │
└─────────────────────────────┘
```

### Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/components/tramites/ExpedienteSidebar.tsx` | Rediseño visual completo: paleta notarial, cards con borde lateral, acciones inline, scroll fix |
| `src/pages/Validacion.tsx` | Eliminar SheetHeader redundante (3 líneas) |

2 archivos. Sin migraciones. Sin dependencias nuevas.

