// scan-document — Orquestador modular.
// Solo enruta por `type` y maneja auth + CORS + errores. Toda la lógica
// específica vive en core/<docType>/{tool,prompt,handler}.ts.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiGatewayErrorResponse } from "../_shared/aiFetch.ts";
import type { DocType, Handler } from "./types.ts";

import { handle as handleCedula } from "./core/cedula/handler.ts";
import { handle as handleCertificadoTradicion } from "./core/certificadoTradicion/handler.ts";
import { handle as handlePredial } from "./core/predial/handler.ts";
import { handle as handleEscrituraAntecedente } from "./core/escrituraAntecedente/handler.ts";
import { handle as handlePoderBanco } from "./core/poderBanco/handler.ts";
import { handle as handleCartaCredito } from "./core/cartaCredito/handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HANDLERS: Record<DocType, Handler> = {
  cedula: handleCedula,
  certificado_tradicion: handleCertificadoTradicion,
  predial: handlePredial,
  escritura_antecedente: handleEscrituraAntecedente,
  poder_banco: handlePoderBanco,
  carta_credito: handleCartaCredito,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // JWT auth — prevent unauthenticated abuse of AI gateway quota
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await sbUser.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { image, type } = await req.json() as { image: string; type: DocType };

    if (!image || !type || !HANDLERS[type]) {
      return new Response(JSON.stringify({ error: "Se requiere 'image' (base64) y 'type' válido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let extractedData: Record<string, unknown>;
    try {
      extractedData = await HANDLERS[type](image, LOVABLE_API_KEY);
    } catch (err) {
      const r = aiGatewayErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }

    // PII-safe logging: never dump the extracted payload (cédulas, NITs, nombres, direcciones, banco).
    console.log("scan-document ok", {
      type,
      fields_count: Object.keys(extractedData).length,
      user: claimsData.claims.sub,
    });

    return new Response(JSON.stringify({ data: extractedData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // PII-safe: nunca loguear el objeto error crudo ni el stack — las
    // respuestas de error de Gemini pueden contener el prompt original con
    // cédulas, nombres y otros datos sensibles.
    const msg = e instanceof Error ? e.message : "Unknown";
    const name = e instanceof Error ? e.name : "Error";
    console.error("[scan-document] error:", name, msg);
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await sb.from("system_events").insert({
        evento: "scan-document",
        resultado: "error",
        categoria: "edge_function",
        detalle: { message: msg, name },
      });
    } catch { /* never break main flow */ }
    return new Response(JSON.stringify({ error: "Error interno del servidor. Intente de nuevo." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
