

## Plan: Tabs de Autenticación — Consistente con Tema Oscuro

### Archivo: `src/pages/LandingPage.tsx`

**Imports:**
- Agregar `Tabs, TabsList, TabsTrigger, TabsContent` desde `@/components/ui/tabs`
- Agregar `useSearchParams` desde `react-router-dom`

**Estado:**
- Reemplazar `const [isRegister, setIsRegister] = useState(false)` por:
  - `const [searchParams] = useSearchParams()`
  - `const [activeTab, setActiveTab] = useState(searchParams.get("tab") === "register" ? "register" : "login")`
- Derivar `isRegister` como `activeTab === "register"`
- Eliminar `acceptedPolicy` del tab login (solo aplica en register)

**Estructura de la card glassmorphism (líneas ~147-245):**

Reemplazar todo el contenido interno de la card por:

```tsx
<Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
  <TabsList className="grid w-full grid-cols-2 bg-white/[0.08] border border-white/10 rounded-xl h-11 p-1">
    <TabsTrigger 
      value="login" 
      className="rounded-lg text-sm font-medium text-slate-400 
        data-[state=active]:bg-white/[0.12] data-[state=active]:text-white 
        data-[state=active]:shadow-sm transition-all"
    >
      Ingresar
    </TabsTrigger>
    <TabsTrigger 
      value="register" 
      className="rounded-lg text-sm font-medium text-slate-400 
        data-[state=active]:bg-white/[0.12] data-[state=active]:text-white 
        data-[state=active]:shadow-sm transition-all"
    >
      Registrarse
    </TabsTrigger>
  </TabsList>

  <TabsContent value="login" className="mt-6">
    <!-- Form: Email + Password + Submit ("Ingresar") -->
    <!-- Sin checkbox, botón siempre habilitado (disabled={loading}) -->
  </TabsContent>

  <TabsContent value="register" className="mt-6">
    <!-- Form: Email + Password + Checkbox Ley 1581 + Submit ("Registrarse") -->
    <!-- Botón disabled={loading || !acceptedPolicy} -->
  </TabsContent>
</Tabs>
```

**Eliminar:**
- Bloque `<div className="mb-4 text-center">` con h2 y descripción (líneas 148-167)
- Bloque `<div className="mt-4 text-center">` con link toggle (líneas 233-243)

**Botón CTA "Empezar ahora" (línea ~125):**
- Cambiar `setIsRegister(true)` por `setActiveTab("register")`

**Estilos clave para consistencia visual:**
- `TabsList`: `bg-white/[0.08]` con `border border-white/10` — se funde con la card glassmorphism
- `TabsTrigger` activo: `bg-white/[0.12]` con texto blanco — sutil elevación sin romper el tema
- `TabsTrigger` inactivo: `text-slate-400` — consistente con el texto secundario de toda la página
- Inputs mantienen su estilo actual: `border-white/10 bg-white/10 text-white`
- Botón submit mantiene `bg-notarial-green` con `shadow-emerald-500/20`

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/pages/LandingPage.tsx` | Tabs reemplaza toggle, eliminar título/link, dos forms separados |

