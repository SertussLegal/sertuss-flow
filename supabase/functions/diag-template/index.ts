// One-shot: corrige las plantillas Davivienda en el bucket.
// 1) Sustituye los tags de la tabla SNR (idx 17-22) por tags de escritura NUEVA → quedan vacíos.
// 2) Separa UBICACIÓN DEL PREDIO ({descripcion_predio}) y NOMBRE O DIRECCIÓN ({nomenclatura_predio}).
// 3) Elimina el literal "(DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO {ciudad_inmueble}" del template
//    (el sufijo lo aporta el backend dentro de nomenclatura_predio).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PizZip from "https://esm.sh/pizzip@3.1.6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "cancelaciones-plantillas";
const FILE_MINUTA = "davivienda/formato cancelacion hipoteca blanqueado.docx";
const FILE_CERT = "davivienda/CERTIFICADO can hipo blanqueado.docx";

// Reemplazos globales en TODO el document.xml (tags exclusivos de la tabla SNR;
// confirmado por diag que no aparecen en otras partes del documento).
const GLOBAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/<w:t([^>]*)>\{numero_escritura_hipoteca_corto\}<\/w:t>/g, "<w:t$1>{numero_escritura_nueva_corto}</w:t>"],
  [/<w:t([^>]*)>\{fecha_escritura_hipoteca_dia\}<\/w:t>/g, "<w:t$1>{fecha_otorgamiento_nueva_dia}</w:t>"],
  [/<w:t([^>]*)>\{fecha_escritura_hipoteca_mes\}<\/w:t>/g, "<w:t$1>{fecha_otorgamiento_nueva_mes}</w:t>"],
  [/<w:t([^>]*)>\{fecha_escritura_hipoteca_ano\}<\/w:t>/g, "<w:t$1>{fecha_otorgamiento_nueva_ano}</w:t>"],
  [/<w:t([^>]*)>\{notaria_hipoteca_numero\}<\/w:t>/g, "<w:t$1>{notaria_emisora_numero_corto}</w:t>"],
  [/<w:t([^>]*)>\{ciudad_hipoteca_corto\}<\/w:t>/g, "<w:t$1>{notaria_emisora_ciudad_corto}</w:t>"],
];

// Reemplazos a nivel de párrafo (necesitan contexto).
function patchParagraph(paraXml: string): string {
  // Reconstruimos el texto plano del párrafo para identificarlo por anclas.
  const flatText = [...paraXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join("");

  if (/UBICACI[ÓO]N DEL PREDIO/.test(flatText)) {
    // p7: usar {descripcion_predio}; quitar {direccion_inmueble_cont}
    return paraXml
      .replace(/<w:t([^>]*)>\{direccion_inmueble\}<\/w:t>/g, "<w:t$1>{descripcion_predio}</w:t>")
      .replace(/<w:t([^>]*)>\{direccion_inmueble_cont\}<\/w:t>/g, "<w:t$1></w:t>");
  }

  if (/NOMBRE O DIRECCI[ÓO]N/.test(flatText)) {
    // p9: usar {nomenclatura_predio}; eliminar literal " (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO " y {ciudad_inmueble}
    let out = paraXml.replace(/<w:t([^>]*)>\{direccion_inmueble\}<\/w:t>/g, "<w:t$1>{nomenclatura_predio}</w:t>");
    // Vaciar los <w:t> que contengan "(DIRECCION CATASTRAL)" o "DE LA CIUDAD Y/O MUNICIPIO"
    out = out.replace(
      /<w:t([^>]*)>([^<]*(?:DIRECCION CATASTRAL|DE LA CIUDAD Y\/O MUNICIPIO)[^<]*)<\/w:t>/gi,
      "<w:t$1></w:t>",
    );
    // Vaciar el tag {ciudad_inmueble} en este párrafo
    out = out.replace(/<w:t([^>]*)>\{ciudad_inmueble\}<\/w:t>/g, "<w:t$1></w:t>");
    return out;
  }

  return paraXml;
}

async function patchFile(sb: ReturnType<typeof createClient>, fileName: string) {
  const { data: blob, error } = await sb.storage.from(BUCKET).download(fileName);
  if (error || !blob) throw new Error(`download ${fileName}: ${error?.message}`);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const zip = new PizZip(buf);

  const docXmlName = "word/document.xml";
  let xml = zip.file(docXmlName)!.asText();

  // Reemplazos globales
  for (const [re, rep] of GLOBAL_REPLACEMENTS) xml = xml.replace(re, rep);

  // Reemplazos por párrafo
  xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, patchParagraph);

  zip.file(docXmlName, xml);
  const out = zip.generate({ type: "uint8array" });

  const { error: upErr } = await sb.storage.from(BUCKET).upload(fileName, out, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (upErr) throw new Error(`upload ${fileName}: ${upErr.message}`);
  return { fileName, bytes: out.byteLength };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const r1 = await patchFile(sb, FILE_MINUTA);
    // El certificado no contiene tags problemáticos según el diag, pero pasamos por la lógica igual.
    const r2 = await patchFile(sb, FILE_CERT);
    return new Response(JSON.stringify({ ok: true, patched: [r1, r2] }, null, 2), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
