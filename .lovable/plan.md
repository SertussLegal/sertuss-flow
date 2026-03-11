

## Plan: "Olvidé mi contraseña" — Enlace + Página de Reset

### Cambios

**1. `src/pages/LandingPage.tsx`** — Agregar enlace "¿Olvidaste tu contraseña?" en el tab de login

En la misma posición donde el tab de registro tiene el checkbox de Ley 1581 (entre el campo de contraseña y el botón submit), agregar un enlace de texto con el mismo estilo `text-xs text-white`:

```tsx
{/* Entre el campo password y el botón Ingresar */}
<button
  type="button"
  onClick={handleForgotPassword}
  className="text-xs text-white underline underline-offset-2 hover:text-notarial-gold transition-colors"
>
  ¿Olvidaste tu contraseña?
</button>
```

Agregar función `handleForgotPassword` que llama a `supabase.auth.resetPasswordForEmail(email)` con `redirectTo` apuntando a `/reset-password`. Muestra toast de confirmación o error si el email está vacío.

**2. `src/pages/ResetPassword.tsx`** — Nueva página de restablecimiento

- Detecta `type=recovery` en el hash de la URL para confirmar sesión de recuperación
- Muestra formulario con campo "Nueva contraseña" + "Confirmar contraseña"
- Llama a `supabase.auth.updateUser({ password })` al enviar
- Redirige a `/dashboard` tras éxito
- Mismos estilos glassmorphism del landing (fondo oscuro, card con backdrop-blur)

**3. `src/App.tsx`** — Agregar ruta pública `/reset-password`

```tsx
<Route path="/reset-password" element={<ResetPassword />} />
```

### Archivos

| Archivo | Cambio |
|---------|--------|
| `src/pages/LandingPage.tsx` | Agregar enlace + handler `handleForgotPassword` en tab login |
| `src/pages/ResetPassword.tsx` | Crear página con formulario de nueva contraseña |
| `src/App.tsx` | Agregar ruta `/reset-password` |

