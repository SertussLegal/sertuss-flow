// ============================================================================
// audit-refs-davivienda — Endpoint dual para auditar los .docx de referencia
// de Davivienda que viven en el bucket privado `cancelaciones-plantillas`.
//
// Rutas:
//   GET /audit-refs-davivienda/hashes  → SOLO metadata (etag+size) del bucket.
//                                        Barato. Soporta If-None-Match → 304.
//                                        Uso: guardia de sincronización en CI.
//   GET /audit-refs-davivienda/tree    → Descarga los .docx y devuelve texto
//                                        extraído (HTML de mammoth). Caro.
//                                        Uso: regeneración manual del contrato.
//
// Auth: requiere header `x-service-key` con `SUPABASE_SERVICE_ROLE_KEY`
// (solo herramientas internas / CI). Rechaza cualquier otra invocación.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BUCKET = "cancelaciones-plantillas";
const FOLDER = "davivienda";
const NATURAL = "EJEMPLO_REFERENCIA_PROSA_NATURAL_DAVIVIENDA.docx";
const JURIDICA = "EJEMPLO_REFERENCIA_PROSA_JURIDICA_DAVIVIENDA.docx";

function unauthorized(msg = "Unauthorized") {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readEtag(obj: Record<string, unknown> | null | undefined): string | null {
  const meta = (obj?.metadata ?? {}) as Record<string, unknown>;
  const raw = (meta.eTag ?? meta.etag ?? null) as string | null;
  return raw ? raw.replace(/^"|"$/g, "") : null;
}
function readSize(obj: Record<string, unknown> | null | undefined): number | null {
  const meta = (obj?.metadata ?? {}) as Record<string, unknown>;
  const s = meta.size as number | string | undefined;
  if (typeof s === "number") return s;
  if (typeof s === "string") return Number.parseInt(s, 10);
  return null;
}

async function fetchMetadata(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.storage.from(BUCKET).list(FOLDER, {
    limit: 100,
    search: "EJEMPLO_REFERENCIA",
  });
  if (error) throw new Error(`list failed: ${error.message}`);

  const natural = data?.find((f) => f.name === NATURAL);
  const juridica = data?.find((f) => f.name === JURIDICA);

  return {
    natural: natural
      ? { path: `${FOLDER}/${NATURAL}`, etag: readEtag(natural), size: readSize(natural), updatedAt: natural.updated_at }
      : null,
    juridica: juridica
      ? { path: `${FOLDER}/${JURIDICA}`, etag: readEtag(juridica), size: readSize(juridica), updatedAt: juridica.updated_at }
      : null,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf.buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchTree(supabase: ReturnType<typeof createClient>) {
  const mammoth = await import("npm:mammoth@1.6.0");

  async function processOne(fileName: string) {
    const { data, error } = await supabase.storage.from(BUCKET).download(`${FOLDER}/${fileName}`);
    if (error || !data) throw new Error(`download ${fileName}: ${error?.message}`);
    const arrayBuffer = await data.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const sha256 = await sha256Hex(bytes);
    // deno-lint-ignore no-explicit-any
    const { value: html } = await (mammoth as any).convertToHtml({ arrayBuffer });
    // deno-lint-ignore no-explicit-any
    const { value: text } = await (mammoth as any).extractRawText({ arrayBuffer });
    return { path: `${FOLDER}/${fileName}`, size: bytes.byteLength, sha256, html, text };
  }

  const [natural, juridica] = await Promise.all([processOne(NATURAL), processOne(JURIDICA)]);
  return { natural, juridica };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const provided = req.headers.get("x-service-key");
  if (!serviceKey || provided !== serviceKey) return unauthorized();

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const url = new URL(req.url);
  const route = url.pathname.split("/").pop() ?? "";

  try {
    if (route === "hashes") {
      const meta = await fetchMetadata(supabase);
      const composite = `${meta.natural?.etag ?? "x"}::${meta.juridica?.etag ?? "x"}`;
      const etag = `W/"${composite}"`;
      if (req.headers.get("if-none-match") === etag) {
        return new Response(null, {
          status: 304,
          headers: { ...corsHeaders, ETag: etag, "Cache-Control": "public, max-age=300" },
        });
      }
      return new Response(JSON.stringify(meta), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          ETag: etag,
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    if (route === "tree") {
      const tree = await fetchTree(supabase);
      return new Response(JSON.stringify(tree), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown route. Use /hashes or /tree." }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message ?? err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
