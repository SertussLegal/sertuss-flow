// Edge function: descubrir-reglas (Paso B - Claude Sonnet 4 real)
//
// Flujo:
//   1. Valida platform admin (403 si no).
//   2. INSERT run status='running'.
//   3. SELECT ≤50 trámites word_generado + logs_extraccion.
//   4. Determinista: diffTramite() por trámite → groupPatterns() top 20.
//   5. Si hay patrones: SELECT 35 reglas activas + llamada a Claude Sonnet 4
//      con tool_use forzado. Parse con Zod. INSERT propuestas válidas
//      (descarta duplicado_de != null). Registra tokens/costo/cop.
//   6. Error entre 4-5: run status='error' con error_detalle, propuestas
//      ya insertadas se conservan.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.25.76";
import { diffTramite, groupPatterns, type Pattern } from "./_patterns.ts";

const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY")!;
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

// Precios oficiales Sonnet 4 (USD por 1M tokens)
const PRICE_INPUT_PER_M = 3;
const PRICE_OUTPUT_PER_M = 15;

interface RequestBody {
  trigger?: "manual" | "cron";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    // ─── 1. Auth ────────────────────────────────────────────────────────────
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

    const { data: adminCheck, error: adminErr } = await userClient.rpc("is_platform_admin");
    if (adminErr) return json({ error: `Admin check failed: ${adminErr.message}` }, 500);
    if (!adminCheck) return json({ error: "Forbidden: platform admin required" }, 403);

    let body: RequestBody = {};
    try { body = (await req.json()) as RequestBody; } catch { body = {}; }
    const trigger = body.trigger === "cron" ? "cron" : "manual";

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ─── 2. INSERT run running ──────────────────────────────────────────────
    const { data: runRow, error: runInsertErr } = await adminClient
      .from("regla_propuesta_run")
      .insert({ status: "running", disparado_por: trigger, triggered_by_user: userId })
      .select("id")
      .single();

    if (runInsertErr || !runRow) {
      return json({ error: `run insert failed: ${runInsertErr?.message}` }, 500);
    }
    const runId = runRow.id as string;

    // ─── 3. SELECT trámites + logs ──────────────────────────────────────────
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

    const tramitesCount = tramites?.length ?? 0;

    // ─── 4. Determinista: diff + group ──────────────────────────────────────
    const allDiffs = [];
    for (const t of tramites ?? []) {
      const log = Array.isArray(t.logs_extraccion) ? t.logs_extraccion[0] : t.logs_extraccion;
      if (!log?.data_final) continue;
      const diffs = diffTramite(t.id, log.data_ia, log.data_final);
      for (const d of diffs) allDiffs.push(d);
    }
    const patterns = groupPatterns(allDiffs);

    console.log(`[descubrir-reglas] tramites=${tramitesCount} diffs=${allDiffs.length} patterns=${patterns.length}`);

    if (patterns.length === 0) {
      const tiempoMs = Date.now() - t0;
      await adminClient
        .from("regla_propuesta_run")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          tramites_analizados: tramitesCount,
          propuestas_generadas: 0,
          tokens_input: 0,
          tokens_output: 0,
          costo_estimado_usd: 0,
          tiempo_ms: tiempoMs,
        })
        .eq("id", runId);
      return json({
        run_id: runId,
        tramites_analizados: tramitesCount,
        diffs_detectados: allDiffs.length,
        patrones_deterministas: 0,
        propuestas_generadas: 0,
        propuestas_duplicadas: 0,
        tiempo_ms: tiempoMs,
      }, 200);
    }

    // ─── 5. Claude Sonnet 4 ─────────────────────────────────────────────────
    const { data: reglas, error: reglasErr } = await adminClient
      .from("reglas_validacion")
      .select("codigo, categoria, descripcion")
      .eq("activa", true);
    if (reglasErr) {
      await markRunError(adminClient, runId, "select_reglas", reglasErr.message, t0);
      return json({ error: `reglas select failed: ${reglasErr.message}` }, 500);
    }

    // Payload compacto a Claude
    const patternsPayload = patterns.map((p, i) => ({
      id: `p${i + 1}`,
      campoRaiz: p.campoRaiz,
      tipo: p.tipo,
      frecuencia: p.frecuencia,
      evidencia: p.evidencia,
    }));

    let tokensInput = 0;
    let tokensOutput = 0;
    let insertedCount = 0;
    let duplicatedCount = 0;

    try {
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(reglas ?? [], patternsPayload);

      const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 8192,
          system: systemPrompt,
          tools: [PROPUESTAS_TOOL],
          tool_choice: { type: "tool", name: "emit_propuestas" },
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      const claudeData = await claudeResp.json();
      if (!claudeResp.ok) {
        throw new Error(`Claude API ${claudeResp.status}: ${JSON.stringify(claudeData?.error ?? claudeData).slice(0, 400)}`);
      }

      tokensInput = claudeData?.usage?.input_tokens ?? 0;
      tokensOutput = claudeData?.usage?.output_tokens ?? 0;

      const toolBlock = (claudeData.content ?? []).find((c: any) => c.type === "tool_use" && c.name === "emit_propuestas");
      if (!toolBlock) throw new Error("Claude no devolvió tool_use emit_propuestas");

      const parsed = PROPUESTAS_SCHEMA.safeParse(toolBlock.input);
      if (!parsed.success) {
        throw new Error(`Zod parse fail: ${parsed.error.message.slice(0, 400)}`);
      }

      const patternById = new Map(patternsPayload.map((p) => [p.id, p]));

      for (const prop of parsed.data.propuestas) {
        const original = patternById.get(prop.id);
        if (!original) continue; // Claude inventó un id, se ignora
        if (prop.duplicado_de) {
          duplicatedCount++;
          continue;
        }
        const { error: insErr } = await adminClient.from("regla_propuesta").insert({
          run_id: runId,
          tipo_acto: prop.tipo_acto,
          categoria: prop.categoria,
          nivel_severidad: prop.nivel_severidad,
          titulo: prop.titulo,
          descripcion: prop.descripcion,
          regla_deterministica_sugerida: prop.regla_deterministica_sugerida,
          campos_afectados: prop.campos_afectados,
          evidencia: original.evidencia.map((e) => ({
            tramite_id: e.tramiteId,
            valor_ia: e.valorIA,
            valor_final: e.valorFinal,
            contexto: e.contexto,
          })),
          frecuencia_estimada: original.frecuencia,
          status: "pendiente",
        });
        if (insErr) {
          console.error("[descubrir-reglas] insert propuesta failed:", insErr.message);
          continue;
        }
        insertedCount++;
      }
    } catch (claudeErr) {
      const msg = claudeErr instanceof Error ? claudeErr.message : String(claudeErr);
      const costoParcial = (tokensInput / 1_000_000) * PRICE_INPUT_PER_M + (tokensOutput / 1_000_000) * PRICE_OUTPUT_PER_M;
      await adminClient
        .from("regla_propuesta_run")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          tiempo_ms: Date.now() - t0,
          tramites_analizados: tramitesCount,
          propuestas_generadas: insertedCount,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          costo_estimado_usd: Number(costoParcial.toFixed(6)),
          error_detalle: { paso: "claude_call_or_parse", mensaje: msg, propuestas_parciales: insertedCount },
        })
        .eq("id", runId);
      return json({
        run_id: runId,
        error: msg,
        propuestas_parciales_insertadas: insertedCount,
      }, 502);
    }

    // ─── 6. Cierre exitoso ──────────────────────────────────────────────────
    const costoUsd = (tokensInput / 1_000_000) * PRICE_INPUT_PER_M + (tokensOutput / 1_000_000) * PRICE_OUTPUT_PER_M;
    const tiempoMs = Date.now() - t0;

    const { error: runUpdateErr } = await adminClient
      .from("regla_propuesta_run")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        tramites_analizados: tramitesCount,
        propuestas_generadas: insertedCount,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        costo_estimado_usd: Number(costoUsd.toFixed(6)),
        tiempo_ms: tiempoMs,
      })
      .eq("id", runId);
    if (runUpdateErr) return json({ error: `run update failed: ${runUpdateErr.message}` }, 500);

    return json({
      run_id: runId,
      tramites_analizados: tramitesCount,
      diffs_detectados: allDiffs.length,
      patrones_deterministas: patterns.length,
      propuestas_generadas: insertedCount,
      propuestas_duplicadas: duplicatedCount,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      costo_estimado_usd: Number(costoUsd.toFixed(6)),
      tiempo_ms: tiempoMs,
    }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `unexpected: ${msg}` }, 500);
  }
});

// ────────────────────────────── Helpers ──────────────────────────────────

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

// ────────────────────────────── Claude ───────────────────────────────────

const PROPUESTAS_TOOL = {
  name: "emit_propuestas",
  description: "Emite una propuesta redactada por cada patrón recibido, en el mismo orden y con el mismo id.",
  input_schema: {
    type: "object",
    properties: {
      propuestas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Id del patrón original (p1, p2, ...)" },
            titulo: { type: "string", maxLength: 80 },
            descripcion: { type: "string", maxLength: 400 },
            tipo_acto: { type: "string", enum: ["compraventa", "hipoteca", "poder", "cancelacion", "todos"] },
            categoria: { type: "string", enum: ["formato", "coherencia", "legal", "negocio"] },
            nivel_severidad: { type: "string", enum: ["error", "advertencia", "sugerencia"] },
            campos_afectados: { type: "array", items: { type: "string" }, minItems: 1 },
            regla_deterministica_sugerida: {
              type: "object",
              properties: {
                tipo: { type: "string", enum: ["regex", "comparacion", "presencia", "rango"] },
                expresion: { type: "string" },
                descripcion_humana: { type: "string" },
              },
              required: ["tipo", "expresion", "descripcion_humana"],
              additionalProperties: false,
            },
            duplicado_de: { type: ["string", "null"], description: "Código de regla existente que ya cubre el patrón, o null." },
          },
          required: [
            "id", "titulo", "descripcion", "tipo_acto", "categoria",
            "nivel_severidad", "campos_afectados", "regla_deterministica_sugerida", "duplicado_de",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["propuestas"],
    additionalProperties: false,
  },
} as const;

const PROPUESTAS_SCHEMA = z.object({
  propuestas: z.array(
    z.object({
      id: z.string(),
      titulo: z.string().max(120),
      descripcion: z.string().max(600),
      tipo_acto: z.enum(["compraventa", "hipoteca", "poder", "cancelacion", "todos"]),
      categoria: z.enum(["formato", "coherencia", "legal", "negocio"]),
      nivel_severidad: z.enum(["error", "advertencia", "sugerencia"]),
      campos_afectados: z.array(z.string()).min(1),
      regla_deterministica_sugerida: z.object({
        tipo: z.enum(["regex", "comparacion", "presencia", "rango"]),
        expresion: z.string(),
        descripcion_humana: z.string(),
      }),
      duplicado_de: z.union([z.string(), z.null()]),
    }),
  ),
});

function buildSystemPrompt(): string {
  return `Eres un redactor técnico especializado en reglas de validación notarial colombiana.

Recibes patrones de corrección humana YA DETECTADOS Y CONTADOS por un proceso determinista. Tu único trabajo es, para cada patrón recibido:

1. Redactar un título (≤80 chars) y descripción (≤400 chars) claros y accionables.
2. Clasificar categoria: formato | coherencia | legal | negocio.
3. Asignar nivel_severidad: error | advertencia | sugerencia. Por defecto usa "sugerencia" salvo evidencia clara de bloqueo legal.
4. Proponer una regla determinista implementable como: regex | comparacion | presencia | rango, con expresion concreta y descripcion_humana.
5. Indicar tipo_acto aplicable: compraventa | hipoteca | poder | cancelacion | todos.

REGLAS ESTRICTAS:
- NO cuentes frecuencias — llegan resueltas en el campo "frecuencia".
- NO inventes patrones nuevos — responde exactamente UN item por patrón recibido, con el mismo "id".
- NO leas ni razones sobre datos fuera del bloque <patrones_readonly>.
- Si un patrón ya está cubierto por una regla existente, marca duplicado_de con el codigo y deja regla_deterministica_sugerida con placeholders vacíos.
- Devuelve JSON estricto vía el tool emit_propuestas, en el mismo orden que recibiste.`;
}

function buildUserPrompt(reglas: Array<{ codigo: string; categoria: string; descripcion: string }>, patterns: unknown[]): string {
  return `<reglas_existentes_readonly>
${JSON.stringify(reglas, null, 0)}
</reglas_existentes_readonly>

<patrones_readonly>
${JSON.stringify(patterns, null, 0)}
</patrones_readonly>

Redacta una propuesta por cada patrón, en el mismo orden, con el mismo "id".`;
}
