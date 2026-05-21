// Devuelve el XML crudo de párrafos específicos para auditar fragmentación
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PizZip from "https://esm.sh/pizzip@3.1.6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "cancelaciones-plantillas";
const FILE = "davivienda/formato cancelacion hipoteca blanqueado.docx";
const PARA_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: blob } = await sb.storage.from(BUCKET).download(FILE);
  const buf = new Uint8Array(await blob!.arrayBuffer());
  const zip = new PizZip(buf);
  const xml = zip.file("word/document.xml")!.asText();
  const target = [7, 9, 17, 18, 19, 20, 21, 22, 34];
  const out: Record<string, string> = {};
  let idx = -1;
  let m;
  PARA_RE.lastIndex = 0;
  while ((m = PARA_RE.exec(xml)) !== null) {
    idx++;
    if (target.includes(idx)) out[`p${idx}`] = m[0];
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
