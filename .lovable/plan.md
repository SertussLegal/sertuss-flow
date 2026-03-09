

## Añadir dedupe de React en vite.config.ts

Agregar `resolve.dedupe` para `react` y `react-dom` en la configuración de Vite. Esto fuerza a que todas las dependencias usen la misma instancia de React, previniendo errores intermitentes causados por múltiples copias de React cargadas simultáneamente (hooks que fallan, refs rotas, etc.).

### Cambio

**`vite.config.ts`** — añadir `dedupe` dentro de `resolve`:

```ts
resolve: {
  dedupe: ["react", "react-dom"],
  alias: {
    "@": path.resolve(__dirname, "./src"),
  },
},
```

Un solo cambio, sin impacto en el resto del proyecto.

