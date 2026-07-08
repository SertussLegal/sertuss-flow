// Edge function: verificar-con-claude (Hito 1 — smoke test)
//
// Contraste dirigido: Claude Sonnet 4.5 lee el Poder General bancario
// (imágenes JPG por página almacenadas en el bucket privado
// `expediente-files`) y confirma/contradice la identidad del apoderado
// que Gemini extrajo previamente en `cancelaciones.data_ia.poder_banco`.
//
// Alcance Hito 1:
//   - Sin persistencia (no escribe en BD).
//   - Sin cobro de créditos.
//   - No dispara hard-block.
//   - Devuelve el JSON de Claude + tokens + costo + tiempo directo en la respuesta.
//   - Requiere sesión de usuario miembro de la organización dueña.
//
// Nota técnica: en este proyecto los poderes se guardan como JPGs por
// página (convención `<cancelacion_id>/cancelaciones/soportes/poder/pXX.jpg`),
// no como PDF. Se envían como bloques `image` base64 (Sonnet 4.5 los acepta
// nativamente). No hay pérdida de información porque estos JPGs son la
// misma fuente que ve Gemini durante `procesar-cancelacion`.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY")!;
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const BUCKET = "expediente-files";

// Precios oficiales Sonnet 4.5 (USD por 1M tokens)
const PRICE_INPUT_PER_M = 3;
const PRICE_OUTPUT_PER_M = 15;

const VERIFICACION_TOOL = {
  name: "emit_verificacion_identidad",
  description:
    "Reporta si los datos de identidad del apoderado ya extraídos por otro sistema coinciden con lo que se lee literalmente en el Poder General adjunto. NO reextraigas desde cero — solo confirma o contradice.",
  input_schema: {
    type: "object" as const,
    properties: {
      nombre_coincide: {
        type: "boolean",
        description:
          "true si el nombre extraído coincide literal o con variantes menores (mayúsculas/tildes/apellidos completos vs abreviados) con el nombre del apoderado que aparece en el poder.",
      },
      cedula_coincide: {
        type: "boolean",
        description:
          "true si la cédula extraída (comparando solo dígitos, ignorando puntos) coincide con la cédula del apoderado que aparece en el poder.",
      },
      sociedad_coincide: {
        type: ["boolean", "null"],
        description:
          "true/false si el nombre de sociedad apoderada dado coincide con lo que se lee. null si no se aportó dato o el poder no menciona sociedad apoderada.",
      },
      poderdante_coincide: {
        type: ["boolean", "null"],
        description:
          "true/false si el poderdante (banco otorgante) dado coincide. null si no se aportó dato.",
      },
      cita_literal_relevante: {
        type: "string",
        description:
          "Fragmento textual EXACTO del poder que sustenta o contradice el juicio (máx 400 chars). Si contradice, cita el nombre/cédula real que lees en el documento.",
      },
      confianza: {
        type: "string",
        enum: ["alta", "media", "baja"],
        description:
          "alta = el texto es perfectamente legible y no hay ambigüedad. media = legible pero con dudas menores. baja = documento borroso, cortado o el dato relevante no aparece.",
      },
      observacion: {
        type: "string",
        description:
          "Explicación breve (≤300 chars) del juicio, especialmente si algún campo es false.",
      },
    },
    required: [
      "nombre_coincide",
      "cedula_coincide",
      "sociedad_coincide",
      "poderdante_coincide",
      "cita_literal_relevante",
      "confianza",
      "observacion",
    ],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `Eres un auditor notarial colombiano. Recibes un Poder General bancario (páginas escaneadas como imágenes) y valores de identidad del apoderado que otro sistema (Gemini) extrajo previamente.

Tu ÚNICA tarea: confirmar o contradecir esos valores contra lo que LEES literalmente en el documento.

REGLAS ESTRICTAS:
1. NO reextraigas desde cero. NO devuelvas los datos que "tú leerías". Solo responde si los valores dados COINCIDEN con lo que aparece en el poder.
2. Cita el fragmento EXACTO (textual) que sustenta tu juicio — sobre todo si contradices.
3. Comparación de cédulas: ignora puntos de miles; compara solo dígitos.
4. Comparación de nombres: acepta variantes de mayúsculas, tildes o segundo apellido faltante como coincidencia. Diferencias de nombre completo (persona distinta) = false.
5. Si el poder no menciona un dato dado, marca ese campo como false con confianza "baja" y explica.
6. Si el documento está ilegible en la cláusula relevante, confianza = "baja".
7. La cláusula de designación de apoderado está usualmente al final del poder (últimas páginas).
8. Responde SIEMPRE llamando al tool emit_verificacion_identidad — nunca texto libre.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function downloadAsBase64(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`download failed ${path}: ${error?.message}`);
  const buf = new Uint8Array(await data.arrayBuffer());
  // Convert to base64 without blowing the stack on large files.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
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

    // ─── 2. Body ───────────────────────────────────────────────────────────
    let body: { cancelacion_id?: string } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const cancelacionId = body.cancelacion_id;
    if (!cancelacionId || typeof cancelacionId !== "string") {
      return json({ error: "cancelacion_id (uuid) requerido" }, 400);
    }

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ─── 3. Autorización a nivel de organización ────────────────────────────
    const { data: cancRow, error: cancErr } = await adminClient
      .from("cancelaciones")
      .select("id, organization_id, data_ia")
      .eq("id", cancelacionId)
      .maybeSingle();
    if (cancErr) return json({ error: `cancelaciones lookup: ${cancErr.message}` }, 500);
    if (!cancRow) return json({ error: "cancelacion no encontrada" }, 404);

    const { data: isMember, error: memberErr } = await userClient.rpc("is_org_member", {
      p_org_id: cancRow.organization_id,
    });
    if (memberErr) return json({ error: `membership check: ${memberErr.message}` }, 500);
    if (!isMember) return json({ error: "Forbidden: no membership" }, 403);

    // ─── 4. Extraer datos ya OCReados por Gemini ────────────────────────────
    const dataIa = (cancRow.data_ia ?? {}) as Record<string, unknown>;
    const pb = (dataIa.poder_banco ?? {}) as Record<string, unknown>;
    const apoderado_nombre = (pb.apoderado_nombre as string | undefined)?.trim() || null;
    const apoderado_cedula = (pb.apoderado_cedula as string | undefined)?.trim() || null;
    const apoderadoObj = (pb.apoderado ?? {}) as Record<string, unknown>;
    const sociedad = (apoderadoObj.razon_social as string | undefined)?.trim() || null;
    const poderdanteObj = (pb.poderdante ?? {}) as Record<string, unknown>;
    const poderdante = (poderdanteObj.razon_social as string | undefined)?.trim() || null;

    if (!apoderado_nombre && !apoderado_cedula) {
      return json({ error: "data_ia.poder_banco sin apoderado_nombre ni apoderado_cedula" }, 422);
    }

    // ─── 5. Listar páginas del poder ────────────────────────────────────────
    const poderPrefix = `${cancelacionId}/cancelaciones/soportes/poder`;
    const { data: poderFiles, error: listErr } = await adminClient.storage
      .from(BUCKET)
      .list(poderPrefix);
    if (listErr) return json({ error: `list poder failed: ${listErr.message}` }, 500);
    if (!poderFiles || poderFiles.length === 0) {
      return json({ error: "No hay páginas del Poder General en storage" }, 404);
    }
    const poderPaths = poderFiles
      .filter((f: { name?: string }) => f.name && /\.jpe?g$/i.test(f.name))
      .sort((a: { name?: string }, b: { name?: string }) => (a.name ?? "").localeCompare(b.name ?? ""))
      .map((f: { name: string }) => `${poderPrefix}/${f.name}`);
    if (poderPaths.length === 0) {
      return json({ error: "No hay páginas JPG del poder" }, 404);
    }

    // ─── 6. Descargar y base64 (todas las páginas) ──────────────────────────
    const tDownload0 = Date.now();
    const b64Pages = await Promise.all(poderPaths.map((p) => downloadAsBase64(adminClient, p)));
    const downloadMs = Date.now() - tDownload0;

    // ─── 7. Llamada Claude con tool_choice forzado ──────────────────────────
    const userContent: unknown[] = [
      {
        type: "text",
        text: `Valores extraídos por Gemini para el apoderado de este poder:
- apoderado_nombre: ${JSON.stringify(apoderado_nombre)}
- apoderado_cedula: ${JSON.stringify(apoderado_cedula)}
- sociedad_apoderada: ${JSON.stringify(sociedad)}
- poderdante: ${JSON.stringify(poderdante)}

Adjunto TODAS las páginas del Poder General (${b64Pages.length} imágenes) en orden. La cláusula de designación de apoderado suele estar al final.

Confirma o contradice CADA campo aportado. Cita el fragmento textual que sustente tu juicio. Llama a emit_verificacion_identidad.`,
      },
      ...b64Pages.map((b64) => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: b64 },
      })),
    ];

    const tClaude0 = Date.now();
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [VERIFICACION_TOOL],
        tool_choice: { type: "tool", name: VERIFICACION_TOOL.name },
        messages: [{ role: "user", content: userContent }],
      }),
    });
    const claudeMs = Date.now() - tClaude0;
    const claudeData = await claudeResp.json();

    if (!claudeResp.ok) {
      return json({
        error: `Claude API ${claudeResp.status}`,
        detail: claudeData?.error ?? claudeData,
        cancelacion_id: cancelacionId,
      }, 502);
    }

    const toolBlock = (claudeData.content ?? []).find(
      (c: { type: string; name?: string }) => c.type === "tool_use" && c.name === VERIFICACION_TOOL.name,
    );
    const verificacion = toolBlock?.input ?? null;

    const tokensInput = claudeData?.usage?.input_tokens ?? 0;
    const tokensOutput = claudeData?.usage?.output_tokens ?? 0;
    const costoUsd =
      (tokensInput * PRICE_INPUT_PER_M) / 1_000_000 +
      (tokensOutput * PRICE_OUTPUT_PER_M) / 1_000_000;

    return json({
      cancelacion_id: cancelacionId,
      requested_by: userId,
      paginas_analizadas: b64Pages.length,
      valores_extraidos_por_gemini: {
        apoderado_nombre,
        apoderado_cedula,
        sociedad,
        poderdante,
      },
      verificacion_claude: verificacion,
      raw_stop_reason: claudeData?.stop_reason ?? null,
      metricas: {
        download_ms: downloadMs,
        claude_ms: claudeMs,
        total_ms: Date.now() - t0,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        costo_usd_estimado: Number(costoUsd.toFixed(6)),
        modelo: CLAUDE_MODEL,
      },
    }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[verificar-con-claude] error:", msg);
    return json({ error: msg, total_ms: Date.now() - t0 }, 500);
  }
});
