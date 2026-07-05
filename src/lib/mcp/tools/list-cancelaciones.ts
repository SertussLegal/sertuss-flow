import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "list_cancelaciones",
  title: "Listar cancelaciones",
  description:
    "Lista las cancelaciones de hipoteca del usuario autenticado en su organización activa, ordenadas por fecha de actualización.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).default(20).describe("Máximo de resultados"),
    status: z.string().optional().describe("Filtro opcional por estado"),
    banco: z.string().optional().describe("Filtro opcional por nombre del banco acreedor"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status, banco }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "No autenticado" }], isError: true };
    }
    let q = sb(ctx)
      .from("cancelaciones")
      .select(
        "id, status, deudor_nombre, deudor_cedula, banco_acreedor, matricula_inmobiliaria, valor_hipoteca, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    if (banco) q = q.ilike("banco_acreedor", `%${banco}%`);
    const { data, error } = await q;
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
