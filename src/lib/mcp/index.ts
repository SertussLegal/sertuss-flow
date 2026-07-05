import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listEscrituras from "./tools/list-escrituras";
import listCancelaciones from "./tools/list-cancelaciones";
import getCancelacion from "./tools/get-cancelacion";
import whoami from "./tools/whoami";

// El issuer OAuth DEBE ser el host directo de Supabase (nunca el proxy .lovable.cloud).
// VITE_SUPABASE_PROJECT_ID es inlined por Vite en build time → import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "sertuss-mcp",
  title: "Sertuss",
  version: "0.1.0",
  instructions:
    "Herramientas de Sertuss (plataforma notarial colombiana). Permite consultar escrituras y cancelaciones de hipoteca de la organización activa del usuario autenticado. Usa `whoami` para verificar la conexión, `list_escrituras` / `list_cancelaciones` para explorar y `get_cancelacion` para ver el detalle completo de una cancelación por ID.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoami, listEscrituras, listCancelaciones, getCancelacion],
});
