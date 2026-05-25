// Temporary one-shot: downloads the cancelaciones template and returns base64.
// Will be deleted after use.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);

  const { data, error } = await supabase.storage
    .from("cancelaciones-plantillas")
    .download("davivienda/formato cancelacion hipoteca blanqueado.docx");

  if (error || !data) {
    return new Response(JSON.stringify({ error: error?.message ?? "no data" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const buf = new Uint8Array(await data.arrayBuffer());
  // Return raw bytes
  return new Response(buf, {
    headers: {
      ...cors,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(buf.byteLength),
    },
  });
});
