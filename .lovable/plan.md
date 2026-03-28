

## Plan: Redirigir "+ Nuevo Trámite" a `/nuevo-tramite`

### Cambio

**`src/pages/Dashboard.tsx`** — Reemplazar `handleNewTramite` (líneas 74-92): eliminar la lógica de crear trámite en DB y simplemente navegar a `/nuevo-tramite`.

```typescript
const handleNewTramite = () => {
  navigate("/nuevo-tramite");
};
```

Un archivo, una función simplificada. La creación del trámite en DB ahora ocurre dentro del flujo de `DocumentUploadStep`.

