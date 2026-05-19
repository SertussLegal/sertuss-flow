/**
 * Identidad del SuperAdmin global de la plataforma.
 * Solo este email puede acceder al panel de Administración cross-tenant.
 */
export const SUPER_ADMIN_EMAIL = "info@sertuss.com";

export const isSuperAdmin = (email?: string | null): boolean =>
  !!email && email.trim().toLowerCase() === SUPER_ADMIN_EMAIL;
