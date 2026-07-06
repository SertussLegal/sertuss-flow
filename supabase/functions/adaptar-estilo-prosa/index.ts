// ============================================================================
// adaptar-estilo-prosa — Sugiere "notas adicionales" para el Parágrafo PRIMERO
// de la comparecencia bancaria a partir de un documento de referencia subido
// por el usuario. Procesamiento efímero in-memory (no persiste el archivo).
//
// Modelo: Gemini 2.5 Flash vía Lovable AI Gateway (sin cobro de créditos Sertuss).
// Salida validada por `OverrideSchema` (bloquea tokens prohibidos y marcadores
// canónicos que romperían la estructura legal).
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { OverrideSchema } from "../../shared/prosaBancos/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const MODEL = "google/gemini-2.5-flash";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
];

const SYSTEM_PROMPT = `Eres un asistente notarial especializado en cancelaciones de hipoteca en Colombia.
El usuario adjuntará un documento de REFERENCIA de estilo. Tu única misión es proponer
"notas adicionales" que se anexarán al final del Parágrafo PRIMERO de una comparecencia
bancaria (Banco Davivienda).

REGLAS INVIOLABLES:
1. NO redactes la comparecencia completa. Solo notas breves complementarias.
2. NO uses estos marcadores canónicos: "COMPARECIÓ:", "PRIMERO.-", "SEGUNDO.-",
   "NIT: 860.034.313-7", "AUTORIZA que el presente instrumento", "BANCO DAVIVIENDA S.A.".
3. NO inventes datos del banco, cédulas, escrituras, notarías ni fechas.
4. NO copies literalmente el nombre del apoderado, razón social o representante legal.
   Solo captura ESTILO y FRASES GENÉRICAS reutilizables.
5. Máximo 800 caracteres.
6. Idioma: español notarial colombiano formal.
7. Si el documento no aporta nada útil, responde con notas vacías.

Devuelve EXCLUSIVAMENTE JSON: {"notas_sugeridas": "..."}`;

interface Payload {
  fileBase64?: string;
  mimeType?: string;
  fileName?: string;
  baseContext?: unknown;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) {
      return json({ error: "LOVABLE_API_KEY no configurada" }, 500);
    }
    const body = (await req.json()) as Payload;
    const { fileBase64, mimeType, fileName } = body;
    if (!fileBase64) return json({ error: "fileBase64 requerido" }, 400);
    if (!mimeType || !ALLOWED_MIME.includes(mimeType)) {
      return json({ error: `MIME no soportado: ${mimeType}` }, 400);
    }
    const approxBytes = Math.floor((fileBase64.length * 3) / 4);
    if (approxBytes > MAX_BYTES) {
      return json({ error: "Archivo excede 8 MB" }, 400);
    }

    // Construimos el content multimodal según sea imagen o documento.
    const isImage = mimeType.startsWith("image/");
    const userContent: unknown[] = [
      {
        type: "text",
        text: `Analiza el documento adjunto${fileName ? ` ("${fileName}")` : ""} y devuelve el JSON con las notas sugeridas.`,
      },
    ];
    if (isImage) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${fileBase64}` },
      });
    } else {
      userContent.push({
        type: "file",
        file: { filename: fileName || "referencia", file_data: `data:${mimeType};base64,${fileBase64}` },
      });
    }

    const upstream = await fetch(GATEWAY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => "");
      if (upstream.status === 429) return json({ error: "Límite de IA alcanzado, intenta más tarde" }, 429);
      if (upstream.status === 402) return json({ error: "Créditos de IA agotados" }, 402);
      return json({ error: `Gateway ${upstream.status}: ${t.slice(0, 200)}` }, 502);
    }

    const data = await upstream.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { notas_sugeridas?: string } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      // Fallback: si el modelo devolvió texto plano, úsalo directo.
      parsed = { notas_sugeridas: content };
    }
    const notas = (parsed.notas_sugeridas ?? "").toString().trim().slice(0, 2000);

    // Sanitización final con el mismo schema compartido — bloquea tokens
    // prohibidos y marcadores canónicos, garantía última contra alucinación.
    const check = OverrideSchema.safeParse({
      notas_adicionales: notas || null,
      campos_editados: null,
      fuente_referencia: "manual",
      actualizado_en: new Date().toISOString(),
    });
    if (!check.success) {
      return json(
        { notas_sugeridas: "", warning: "Sugerencia bloqueada por sanitización (contenía tokens prohibidos)" },
        200,
      );
    }

    return json({ notas_sugeridas: notas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
