// One-shot: inspecciona y/o aplica cirugía a la plantilla v1 → v2.
// Modos:
//   ?mode=dump           → devuelve fragmentos XML alrededor de tokens críticos
//   ?mode=apply          → escribe "formato cancelacion hipoteca v2.docx"
//   ?mode=raw            → devuelve los primeros N caracteres del document.xml para inspección directa
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PizZip from "https://esm.sh/pizzip@3.1.6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "cancelaciones-plantillas";
const PREFIX = "davivienda/";
const V1 = "formato cancelacion hipoteca blanqueado.docx";
const V2 = "formato cancelacion hipoteca blanqueado v2.docx";

function snippets(xml: string, needles: string[], radius = 800): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const n of needles) {
    const arr: string[] = [];
    let from = 0;
    for (;;) {
      const idx = xml.indexOf(n, from);
      if (idx < 0) break;
      arr.push(xml.slice(Math.max(0, idx - radius), Math.min(xml.length, idx + n.length + radius)));
      from = idx + n.length;
      if (arr.length >= 4) break;
    }
    out[n] = arr;
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "dump";

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supa.storage.from(BUCKET).download(`${PREFIX}${V1}`);
  if (error || !data) return new Response(JSON.stringify({ ok: false, error: error?.message }), { status: 500, headers: cors });

  const zip = new PizZip(new Uint8Array(await data.arrayBuffer()));
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) return new Response(JSON.stringify({ ok: false, error: "no document.xml" }), { status: 500, headers: cors });
  let xml = docXmlFile.asText();

  if (mode === "raw") {
    const start = parseInt(url.searchParams.get("start") || "0", 10);
    const len = parseInt(url.searchParams.get("len") || "6000", 10);
    return new Response(JSON.stringify({ ok: true, totalLen: xml.length, slice: xml.slice(start, start + len) }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (mode === "dump") {
    const needles = [
      "nomenclatura_predio",
      "direccion_inmueble",
      "ciudad_inmueble",
      "DIRECCION CATASTRAL",
      "Y/O MUNICIPIO",
      "TERCERO",
      "QUINTO",
      "aplica_ley_546",
      "valor_hipoteca_protocolo",
      "valor_hipoteca_letras",
      "valor_hipoteca_numeros",
      "Ley 546",
      "PARAGRAFO",
      "PARÁGRAFO",
      "SEGUNDO",
      "Notaria",
      "limitaciones_concurrentes",
      "clausula_pago_hipoteca",
      "direccion_completa_saneada",
    ];
    return new Response(JSON.stringify({ ok: true, totalLen: xml.length, snippets: snippets(xml, needles) }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (mode === "apply") {
    const before = xml.length;
    // Las reglas exactas se inyectan aquí en el próximo paso, una vez confirmados los runs.
    // El cliente debe enviar un array de patches en el body para máxima trazabilidad.
    let patches: Array<{ find: string; replace: string; required?: boolean }> = [];
    try {
      const body = await req.json();
      patches = body?.patches || [];
    } catch { /* sin body */ }

    const report: Array<{ find: string; applied: boolean }> = [];
    for (const p of patches) {
      const idx = xml.indexOf(p.find);
      if (idx < 0) {
        report.push({ find: p.find.slice(0, 60), applied: false });
        if (p.required) {
          return new Response(JSON.stringify({ ok: false, error: "patch not found", patch: p.find.slice(0, 200), report }), {
            status: 422, headers: { ...cors, "Content-Type": "application/json" },
          });
        }
        continue;
      }
      // Replace ALL occurrences
      xml = xml.split(p.find).join(p.replace);
      report.push({ find: p.find.slice(0, 60), applied: true });
    }

    zip.file("word/document.xml", xml);
    const out = zip.generate({ type: "uint8array" });
    const { error: upErr } = await supa.storage.from(BUCKET).upload(`${PREFIX}${V2}`, out, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (upErr) return new Response(JSON.stringify({ ok: false, error: upErr.message, report }), { status: 500, headers: cors });
    return new Response(JSON.stringify({ ok: true, beforeLen: before, afterLen: xml.length, report }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: "invalid mode" }), { status: 400, headers: cors });
});
