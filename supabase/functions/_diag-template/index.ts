// Temporal: vuelca los tags {variable} de las plantillas Davivienda
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PizZip from "https://esm.sh/pizzip@3.1.6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "cancelaciones-plantillas";
const FILES = [
  "davivienda/formato cancelacion hipoteca blanqueado.docx",
  "davivienda/CERTIFICADO can hipo blanqueado.docx",
];

const PARA_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const RUN_RE = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const TAG_RE = /\{[#/^]?[a-zA-Z0-9_.\-]+\}/g;

function extractRunsText(p: string): string {
  const runs: string[] = [];
  RUN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_RE.exec(p)) !== null) {
    const xml = m[0];
    const open = xml.match(/<w:t(?:\s[^>]*)?>/);
    if (!open) continue;
    const start = open.index! + open[0].length;
    const end = xml.indexOf("</w:t>", start);
    if (end < 0) continue;
    runs.push(xml.slice(start, end));
  }
  return runs.join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const out: Record<string, unknown> = {};
  for (const file of FILES) {
    const { data: blob, error } = await sb.storage.from(BUCKET).download(file);
    if (error || !blob) { out[file] = { error: error?.message }; continue; }
    const buf = new Uint8Array(await blob.arrayBuffer());
    const zip = new PizZip(buf);
    const tagsOrdered: string[] = [];
    const paragraphsWithTags: { idx: number; text: string; tags: string[] }[] = [];
    for (const name of Object.keys(zip.files)) {
      if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
      const xml = zip.file(name)!.asText();
      let pIdx = -1;
      let pm;
      PARA_RE.lastIndex = 0;
      while ((pm = PARA_RE.exec(xml)) !== null) {
        pIdx++;
        const text = extractRunsText(pm[0]);
        const tags = [...text.matchAll(TAG_RE)].map(m => m[0]);
        if (tags.length > 0 || /catastral|DIRECCION CATASTRAL/i.test(text)) {
          paragraphsWithTags.push({ idx: pIdx, text: text.slice(0, 400), tags });
        }
        for (const t of tags) tagsOrdered.push(t);
      }
    }
    out[file] = { uniqueTags: [...new Set(tagsOrdered)], paragraphsWithTags };
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
