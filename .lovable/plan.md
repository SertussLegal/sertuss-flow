

## Diagnóstico: Diferencia de altura entre tabs

El salto de altura se debe a dos diferencias entre los contenidos de cada tab:

1. **Login form** (línea 180): tiene `className="space-y-4 py-0 my-[16px]"` — agrega 16px de margen vertical extra.
2. **Register form** (línea 229): tiene `className="space-y-4"` — sin margen extra.
3. **Register** tiene el bloque del checkbox + label de Ley 1581 (líneas 259-280), que ocupa más altura vertical que el enlace "¿Olvidaste tu contraseña?" del login (líneas 210-218).

La combinación de estos factores causa que la tarjeta cambie de tamaño al alternar tabs.

## Solución

Igualar la altura de ambos tabs fijando una altura mínima consistente en el contenedor de la card, y normalizando los estilos de los formularios:

| Archivo | Cambio |
|---------|--------|
| `src/pages/LandingPage.tsx` | 1. Normalizar clases del login form: cambiar `"space-y-4 py-0 my-[16px]"` a `"space-y-4"` para que coincida con register. 2. Agregar `min-h-[340px]` (o valor equivalente) a ambos `TabsContent` para que ocupen el mismo espacio mínimo, eliminando el salto visual. |

Cambio mínimo, sin afectar funcionalidad.

