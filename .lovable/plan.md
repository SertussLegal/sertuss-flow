# Fix UI-1.3 — `Badge` a `forwardRef` para desbloquear Tooltip

## Diagnóstico de impacto

**Consumidores de `Badge`:** 15 archivos, ~43 usos totales (`<Badge …>`), distribuidos en Validacion, Cancelaciones, Admin, Team, Dashboard, DocxDebugModal, PreviewModal, ProsaApoderado*, SystemMonitor, ReglasPropuestas, NotariaSettings, OcrBadge, CancelacionValidar.

**Uso de `ref` explícita sobre `<Badge>` hoy:** cero (`rg "<Badge[^>]*\bref=" src/` → sin resultados). Nadie depende del comportamiento actual "no acepta ref".

**Snapshots que puedan romperse:** solo `src/shared/prosaBancos/__contract__/parity.test.ts`, que serializa prosa de bancos y no toca `Badge`. Sin riesgo.

**Cambio HTML:** cero. `forwardRef` solo agrega captura de la ref; el elemento renderizado sigue siendo el mismo `<div className={cn(badgeVariants({ variant }), className)} {...props} />` con exactamente los mismos props. 100% aditivo, no cosmético.

## Cambio único

`src/components/ui/badge.tsx`:

```tsx
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
```

Sin cambios en `BadgeProps`, `badgeVariants`, ni en ninguno de los 15 archivos consumidores.

## Verificación

1. Suite completo Vitest + Deno. Esperado: 226/226 + 66/66 sin regresiones (ningún test depende de que Badge sea función plana).
2. Reproducción en navegador real: la sesión Supabase no se inyecta en el sandbox actual (`/cancelaciones` redirige a login), así que la verificación visual del hover queda del lado del usuario en el preview autenticado — se le pedirá confirmar que al pasar el mouse sobre "Bloqueada" y "Con alertas" ahora aparece el tooltip con el texto explicativo. Si el usuario prefiere que intente inyectar sesión antes, lo hago primero.

## Criterios de aceptación

- Vitest y Deno siguen en verde con los mismos totales.
- Tooltip visible en hover sobre badges "Bloqueada" / "Con alertas" en `/cancelaciones` (confirmación visual del usuario).
- Ningún cambio visible en los otros 43 usos de `Badge` en la app.
