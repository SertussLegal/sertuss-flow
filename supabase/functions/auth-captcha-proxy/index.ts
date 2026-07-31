import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

type TurnstileOutcome = {
  success: boolean;
  errorCodes: string[];
  hostname: string | null;
  challengeTs: string | null;
};

async function verifyTurnstile(token: string, ip: string): Promise<TurnstileOutcome> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });
  const outcome = await result.json();
  return {
    success: outcome?.success === true,
    errorCodes: Array.isArray(outcome?.["error-codes"]) ? outcome["error-codes"] : [],
    hostname: outcome?.hostname ?? null,
    challengeTs: outcome?.challenge_ts ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, email, password, captchaToken, fullName, orgName, nit, emailRedirectTo } = body ?? {};

    if (!action || !email || !password || !captchaToken) {
      return new Response(JSON.stringify({ error: { message: "Faltan campos requeridos." } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const captchaOk = await verifyTurnstile(captchaToken, ip);
    if (!captchaOk) {
      return new Response(JSON.stringify({ error: { message: "Verificación de seguridad fallida. Intenta de nuevo." } }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    if (action === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo,
          data: {
            full_name: (fullName ?? "").trim(),
            org_name: (orgName ?? "").trim(),
            nit: (nit ?? "").trim(),
          },
        },
      });
      if (error) {
        return new Response(JSON.stringify({ error: { message: error.message } }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "signin") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        return new Response(JSON.stringify({ error: { message: error.message } }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, session: data.session }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: { message: "Acción no reconocida." } }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: (e as Error).message } }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
