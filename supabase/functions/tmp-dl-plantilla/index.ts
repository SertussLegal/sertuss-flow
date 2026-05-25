// One-shot upload: replace the cancelaciones template in storage.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);

  const bytes = new Uint8Array(await req.arrayBuffer());
  const { error } = await supabase.storage
    .from("cancelaciones-plantillas")
    .upload(
      "davivienda/formato cancelacion hipoteca blanqueado.docx",
      bytes,
      {
        upsert: true,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    );

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, size: bytes.byteLength }), {
    headers: { "Content-Type": "application/json" },
  });
});
