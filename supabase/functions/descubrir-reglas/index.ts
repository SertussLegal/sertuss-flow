// Edge function: descubrir-reglas (Paso A - esqueleto MOCK)
//
// Fase 2 del plan aprobado. Este esqueleto:
//   1. Valida que quien invoca es platform admin (is_platform_admin()).
//   2. Inserta una fila en regla_propuesta_run con status='running'.
//   3. Selecciona hasta 50 trámites con status='word_generado' + sus logs_extraccion.
//   4. Selecciona las reglas activas de reglas_validacion (para referencia futura).
//   5. Devuelve una respuesta MOCK y marca el run como status='success' con
//      propuestas_generadas=0. NO llama a Claude todavía (eso es el Paso B).
//
// verify_jwt = true: entra por config.toml en la próxima entrega. Por defecto la
// plataforma deploya con verify_jwt=false, así que la validación de admin se hace
// en código con getClaims() + is_platform_admin().

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface RequestBody {
  trigger?: "manual" | "cron";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    // ─── 1. Auth: JWT del caller ────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized: missing bearer" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ error: "Unauthorized: invalid token" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    // ─── 2. Admin check (server-authoritative) ──────────────────────────────
    // is_platform_admin() lee auth.uid() del contexto, así que lo evaluamos
    // con el cliente autenticado por el JWT del usuario, no con service_role.
    const { data: adminCheck, error: adminErr } = await userClient.rpc("is_platform_admin");
    if (adminErr) {
      return json({ error: `Admin check failed: ${adminErr.message}` }, 500);
    }
    if (!adminCheck) {
      return json({ error: "Forbidden: platform admin required" }, 403);
    }

    // ─── 3. Body ────────────────────────────────────────────────────────────
    let body: RequestBody = {};
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      body = {};
    }
    const trigger = body.trigger === "cron" ? "cron" : "manual";

    // A partir de aquí usamos service_role para bypass RLS de lectura masiva
    // y para escribir en regla_propuesta_run. Ya validamos que el caller es admin.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ─── 4. INSERT run status='running' ─────────────────────────────────────
    const { data: runRow, error: runInsertErr } = await adminClient
      .from("regla_propuesta_run")
      .insert({
        status: "running",
        disparado_por: trigger,
        triggered_by_user: userId,
      })
      .select("id")
      .single();

    if (runInsertErr || !runRow) {
      return json({ error: `run insert failed: ${runInsertErr?.message}` }, 500);
    }
    const runId = runRow.id as string;

    // ─── 5. SELECT trámites word_generado + logs_extraccion ─────────────────
    // 50 más recientes por updated_at desc.
    const { data: tramites, error: tramitesErr } = await adminClient
      .from("tramites")
      .select("id, tipo, updated_at, logs_extraccion(id, data_ia, data_final)")
      .eq("status", "word_generado")
      .order("updated_at", { ascending: false })
      .limit(50);

    if (tramitesErr) {
      await markRunError(adminClient, runId, "select_tramites", tramitesErr.message, t0);
      return json({ error: `tramites select failed: ${tramitesErr.message}` }, 500);
    }

    // ─── 6. SELECT reglas activas ───────────────────────────────────────────
    const { data: reglas, error: reglasErr } = await adminClient
      .from("reglas_validacion")
      .select("codigo, categoria, descripcion, nivel_severidad, tipo_acto")
      .eq("activa", true);

    if (reglasErr) {
      await markRunError(adminClient, runId, "select_reglas", reglasErr.message, t0);
      return json({ error: `reglas select failed: ${reglasErr.message}` }, 500);
    }

    // ─── 7. MOCK: NO se llama a Claude. Marcar run success con 0 propuestas ─
    const tiempoMs = Date.now() - t0;
    const { error: runUpdateErr } = await adminClient
      .from("regla_propuesta_run")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        tramites_analizados: tramites?.length ?? 0,
        propuestas_generadas: 0,
        tokens_input: 0,
        tokens_output: 0,
        costo_estimado_usd: 0,
        tiempo_ms: tiempoMs,
      })
      .eq("id", runId);

    if (runUpdateErr) {
      return json({ error: `run update failed: ${runUpdateErr.message}` }, 500);
    }

    return json(
      {
        run_id: runId,
        tramites_analizados: tramites?.length ?? 0,
        reglas_activas: reglas?.length ?? 0,
        propuestas_generadas: 0,
        tiempo_ms: tiempoMs,
        mock: true,
      },
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `unexpected: ${msg}` }, 500);
  }
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function markRunError(
  client: ReturnType<typeof createClient>,
  runId: string,
  paso: string,
  mensaje: string,
  t0: number,
) {
  await client
    .from("regla_propuesta_run")
    .update({
      status: "error",
      finished_at: new Date().toISOString(),
      tiempo_ms: Date.now() - t0,
      error_detalle: { paso, mensaje },
    })
    .eq("id", runId);
}
