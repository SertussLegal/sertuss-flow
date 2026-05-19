// Procesa una cancelación de hipoteca Davivienda:
// 1) Cobra 2 créditos
// 2) Llama a Gemini 2.5 Pro (Lovable AI Gateway) con los 2 PDFs (cert. tradición + escritura)
// 3) Rellena 2 plantillas .docx con Docxtemplater
// 4) Sube minutas a Storage y persiste en cancelaciones
//
// Modo "regen": si se envía { cancelacionId, regen: true } solo re-mapea las plantillas
// usando data_final, sin cobrar créditos ni llamar a Gemini.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PizZip from "https://esm.sh/pizzip@3.1.6";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import { fetchAiGateway, AiGatewayError, parseToolCallArguments } from "../_shared/aiFetch.ts";

// Envelope helper: 200 OK con { ok:false, code, message } para errores de negocio
function biz(code: string, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, code, message, ...extra }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET_PLANTILLAS = "cancelaciones-plantillas";
const BUCKET_OUTPUT = "expediente-files";
const PREFIX_DAVIVIENDA = "davivienda/";
const TEMPLATE_MINUTA = "formato cancelacion hipoteca blanqueado.docx";
const TEMPLATE_CERT = "CERTIFICADO can hipo blanqueado.docx";

// Datos fijos del apoderado de Davivienda (vigentes para este mes)
const APODERADO_FIJO = {
  apoderado_nombre: "HEIBER HERNAN BELTRAN TORRES",
  apoderado_cedula: "1.033.718.974",
  apoderado_escritura: "4035",
  apoderado_fecha_poder: "19 de agosto de 2025",
  apoderado_notaria_poder: "24 de Bogotá D.C.",
};

interface CancelacionData {
  hipoteca_anterior: {
    numero_escritura_hipoteca: string;
    fecha_escritura_hipoteca: string;
    notaria_hipoteca: string;
    valor_hipoteca_original: string;
  };
  inmueble: {
    matricula_inmobiliaria: string;
    direccion_completa: string;
    ciudad: string;
  };
  partes: {
    deudor_nombre: string;
    deudor_identificacion: string;
    deudor_tipo_id: string;
    banco_acreedor: string;
    banco_nit: string;
  };
  analisis_legal: {
    aplica_ley_546: boolean;
    explicacion_ley: string;
  };
}

const tools = [
  {
    type: "function" as const,
    function: {
      name: "extract_cancelacion_hipoteca",
      description: "Extrae los datos de cancelación de hipoteca a partir del Certificado de Tradición y Libertad y la Escritura Pública de constitución de hipoteca.",
      parameters: {
        type: "object",
        properties: {
          hipoteca_anterior: {
            type: "object",
            properties: {
              numero_escritura_hipoteca: { type: "string", description: "Número de escritura en LETRAS Y NÚMEROS, ej: 'CUATRO MIL CIENTO SESENTA Y CINCO (4165)'" },
              fecha_escritura_hipoteca: { type: "string", description: "Fecha en LETRAS Y NÚMEROS, ej: 'NUEVE (09) DE OCTUBRE DE DOS MIL VEINTE (2020)'" },
              notaria_hipoteca: { type: "string", description: "Notaría en LETRAS Y NÚMEROS + ciudad, ej: 'TREINTA Y OCHO (38) DE BOGOTA D.C.'" },
              valor_hipoteca_original: { type: "string", description: "Valor en LETRAS Y NÚMEROS, ej: 'CUARENTA Y OCHO MILLONES DOSCIENTOS MIL PESOS ($48.200.000)'" },
            },
            required: ["numero_escritura_hipoteca", "fecha_escritura_hipoteca", "notaria_hipoteca", "valor_hipoteca_original"],
            additionalProperties: false,
          },
          inmueble: {
            type: "object",
            properties: {
              matricula_inmobiliaria: { type: "string", description: "Matrícula en LETRAS Y NÚMEROS, ej: 'CINCUENTA C - DOSCIENTOS OCHO MIL QUINIENTOS CUARENTA Y DOS (50C-2085432)'" },
              direccion_completa: { type: "string", description: "Dirección completa. Si la ciudad es BOGOTA D.C., concatena obligatoriamente ' (DIRECCION CATASTRAL)' al final" },
              ciudad: { type: "string", description: "Ciudad en mayúsculas, ej: 'BOGOTA D.C.'" },
            },
            required: ["matricula_inmobiliaria", "direccion_completa", "ciudad"],
            additionalProperties: false,
          },
          partes: {
            type: "object",
            properties: {
              deudor_nombre: { type: "string", description: "Nombre completo del deudor en mayúsculas" },
              deudor_identificacion: { type: "string", description: "Número de identificación ESTRICTAMENTE NUMÉRICO con puntos de miles, ej: '1.018.440.535'. SIN letras." },
              deudor_tipo_id: { type: "string", description: "Tipo de identificación, ej: 'CEDULA DE CIUDADANIA'" },
              banco_acreedor: { type: "string", description: "Razón social del banco, normalmente 'BANCO DAVIVIENDA S.A.'" },
              banco_nit: { type: "string", description: "NIT ESTRICTAMENTE NUMÉRICO con puntos y guión, ej: '860.034.313-7'. SIN letras." },
            },
            required: ["deudor_nombre", "deudor_identificacion", "deudor_tipo_id", "banco_acreedor", "banco_nit"],
            additionalProperties: false,
          },
          analisis_legal: {
            type: "object",
            properties: {
              aplica_ley_546: { type: "boolean", description: "true si la hipoteca se constituyó conjuntamente con la compraventa de vivienda (Ley 546 de 1999)" },
              explicacion_ley: { type: "string", description: "Explicación detallada del análisis" },
            },
            required: ["aplica_ley_546", "explicacion_ley"],
            additionalProperties: false,
          },
        },
        required: ["hipoteca_anterior", "inmueble", "partes", "analisis_legal"],
        additionalProperties: false,
      },
    },
  },
];

const SYSTEM_PROMPT = `Eres un asistente jurídico experto en derecho notarial colombiano especializado en cancelaciones de hipoteca de BANCO DAVIVIENDA S.A.

Recibes dos documentos:
1. Certificado de Tradición y Libertad del inmueble
2. Escritura Pública de Constitución de Hipoteca

REGLAS ESTRICTAS DE FORMATO:
- Toda escritura, notaría, valor y fecha debe expresarse en DOBLE EXPRESIÓN: LETRAS y NÚMEROS entre paréntesis.
- Las identificaciones (deudor_identificacion, banco_nit) son ESTRICTAMENTE NUMÉRICAS, con puntos de miles. Nunca letras.
- Si la ciudad del inmueble es BOGOTA D.C. o BOGOTÁ D.C., concatena obligatoriamente ' (DIRECCION CATASTRAL)' al final de direccion_completa.
- Texto siempre en MAYÚSCULAS para nombres, ciudades, notarías.
- aplica_ley_546 = true cuando la constitución de la hipoteca se otorga en la misma escritura pública que la compraventa de vivienda de interés social/prioritario o vivienda financiada.

Llama SIEMPRE a la herramienta extract_cancelacion_hipoteca.`;

// Build the variable map sent to Docxtemplater
function buildDocxVars(data: CancelacionData) {
  return {
    // Hipoteca anterior
    numero_escritura_hipoteca: data.hipoteca_anterior.numero_escritura_hipoteca,
    fecha_escritura_hipoteca: data.hipoteca_anterior.fecha_escritura_hipoteca,
    notaria_hipoteca: data.hipoteca_anterior.notaria_hipoteca,
    valor_hipoteca_original: data.hipoteca_anterior.valor_hipoteca_original,
    // Inmueble
    matricula_inmobiliaria: data.inmueble.matricula_inmobiliaria,
    direccion_inmueble: data.inmueble.direccion_completa,
    ciudad_inmueble: data.inmueble.ciudad,
    // Partes
    deudor_nombre: data.partes.deudor_nombre,
    deudor_identificacion: data.partes.deudor_identificacion,
    deudor_tipo_id: data.partes.deudor_tipo_id,
    banco_acreedor: data.partes.banco_acreedor,
    banco_nit: data.partes.banco_nit,
    // Ley 546 (controla la sección {#aplica_ley_546}...{/aplica_ley_546})
    aplica_ley_546: data.analisis_legal.aplica_ley_546,
    // Apoderado fijo
    ...APODERADO_FIJO,
  };
}

async function fillTemplate(
  supabase: ReturnType<typeof createClient>,
  templateName: string,
  vars: Record<string, unknown>,
): Promise<Uint8Array> {
  const { data: blob, error } = await supabase.storage
    .from(BUCKET_PLANTILLAS)
    .download(`${PREFIX_DAVIVIENDA}${templateName}`);
  if (error || !blob) throw new Error(`No se pudo descargar plantilla ${templateName}: ${error?.message}`);

  const buf = new Uint8Array(await blob.arrayBuffer());
  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "___________",
  });
  doc.render(vars);
  const out = doc.getZip().generate({ type: "uint8array" });
  return out;
}

async function createSignedStorageUrl(
  supabase: ReturnType<typeof createClient>,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_OUTPUT)
    .createSignedUrl(path, 60 * 30);
  if (error || !data?.signedUrl) throw new Error(`No se pudo firmar PDF ${path}: ${error?.message}`);
  return data.signedUrl;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: claimsData, error: claimsErr } = await supabaseUser.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (claimsErr || !claimsData?.claims?.sub) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claimsData.claims.sub as string;

  let body: { cancelacionId?: string; certificadoPath?: string; escrituraPath?: string; regen?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { cancelacionId, certificadoPath, escrituraPath, regen } = body;
  if (!cancelacionId) {
    return new Response(JSON.stringify({ error: "cancelacionId requerido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load cancelación + verify org
  const { data: cancRow, error: cancErr } = await supabaseService
    .from("cancelaciones")
    .select("*")
    .eq("id", cancelacionId)
    .maybeSingle();
  if (cancErr || !cancRow) {
    return new Response(JSON.stringify({ error: "Cancelación no encontrada" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const orgId = cancRow.organization_id as string;

  // Verify user is member of org
  const { data: membership } = await supabaseService
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!membership) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // MODO REGEN: solo re-mapeo docx con data_final, sin cobrar
    // ─────────────────────────────────────────────────────────────
    if (regen) {
      const data: CancelacionData = cancRow.data_final ?? cancRow.data_ia;
      if (!data) {
        return new Response(JSON.stringify({ error: "No hay datos para regenerar" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const vars = buildDocxVars(data);
      const minuta = await fillTemplate(supabaseService, TEMPLATE_MINUTA, vars);
      const certificado = await fillTemplate(supabaseService, TEMPLATE_CERT, vars);

      const minutaPath = `cancelaciones/${cancelacionId}/minuta.docx`;
      const certPath = `cancelaciones/${cancelacionId}/certificado.docx`;
      await supabaseService.storage.from(BUCKET_OUTPUT).upload(minutaPath, minuta, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
      await supabaseService.storage.from(BUCKET_OUTPUT).upload(certPath, certificado, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
      await supabaseService.from("cancelaciones").update({
        url_minuta_generada: minutaPath,
        url_certificado_generado: certPath,
        updated_at: new Date().toISOString(),
      }).eq("id", cancelacionId);

      return new Response(JSON.stringify({ ok: true, regenerated: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // MODO NORMAL: cobro + IA + docx + persistencia
    // ─────────────────────────────────────────────────────────────
    if (!certificadoPath || !escrituraPath) {
      return new Response(JSON.stringify({ error: "Archivos PDF requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Cobro de 2 créditos (con auditoría obligatoria → p_tramite_id requerido)
    const { data: charge, error: chargeErr } = await supabaseService.rpc("consume_credit_v2", {
      p_org_id: orgId,
      p_user_id: userId,
      p_action: "GENERACION_DOCX",
      p_tramite_id: cancelacionId,
      p_tipo_acto: "cancelacion_hipoteca",
      p_credits: 2,
    });
    if (chargeErr) {
      console.error("[procesar-cancelacion] consume_credit_v2 chargeErr:", chargeErr);
      return biz(
        "credit_charge_error",
        "No se pudo registrar el consumo de créditos en la auditoría. Contacte a soporte técnico.",
      );
    }
    if (charge !== true) {
      return biz(
        "credits_blocked",
        "No tienes créditos suficientes para procesar esta cancelación (requiere 2 créditos).",
      );
    }

    // Marcar processing
    await supabaseService.from("cancelaciones").update({
      status: "processing", created_by: userId, error_message: null,
    }).eq("id", cancelacionId);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    // Capturamos solo rutas livianas; los PDFs quedan en Storage privado y se leen por URL firmada.
    const certInputPath = certificadoPath;
    const escInputPath = escrituraPath;

    // ── Trabajo pesado en background — evita WORKER_RESOURCE_LIMIT ──
    const heavyWork = async () => {
      try {
        const [certUrl, escUrl] = await Promise.all([
          createSignedStorageUrl(supabaseService, certInputPath),
          createSignedStorageUrl(supabaseService, escInputPath),
        ]);

        const aiBody = {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Analiza los siguientes documentos y extrae los datos para una cancelación de hipoteca de Davivienda. Llama a extract_cancelacion_hipoteca con TODOS los campos requeridos." },
                { type: "image_url", image_url: { url: certUrl } },
                { type: "image_url", image_url: { url: escUrl } },
              ],
            },
          ],
          tools,
          tool_choice: { type: "function", function: { name: "extract_cancelacion_hipoteca" } },
        };

        const aiResp = await fetchAiGateway({ apiKey: LOVABLE_API_KEY, body: aiBody, tag: "procesar-cancelacion" });
        const extracted = await parseToolCallArguments<CancelacionData>(aiResp, "procesar-cancelacion");

        const vars = buildDocxVars(extracted);
        const minuta = await fillTemplate(supabaseService, TEMPLATE_MINUTA, vars);
        const certificado = await fillTemplate(supabaseService, TEMPLATE_CERT, vars);

        const minutaOutputPath = `cancelaciones/${cancelacionId}/minuta.docx`;
        const certOutputPath = `cancelaciones/${cancelacionId}/certificado.docx`;
        const { error: upMinErr } = await supabaseService.storage.from(BUCKET_OUTPUT).upload(minutaOutputPath, minuta, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
        if (upMinErr) throw new Error(`Upload minuta: ${upMinErr.message}`);
        const { error: upCertErr } = await supabaseService.storage.from(BUCKET_OUTPUT).upload(certOutputPath, certificado, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
        if (upCertErr) throw new Error(`Upload certificado: ${upCertErr.message}`);

        const { error: updErr } = await supabaseService.from("cancelaciones").update({
          status: "completed",
          data_ia: extracted,
          data_final: extracted,
          numero_escritura_hipoteca: extracted.hipoteca_anterior.numero_escritura_hipoteca,
          fecha_escritura_hipoteca: extracted.hipoteca_anterior.fecha_escritura_hipoteca,
          notaria_hipoteca: extracted.hipoteca_anterior.notaria_hipoteca,
          valor_hipoteca_original: extracted.hipoteca_anterior.valor_hipoteca_original,
          matricula_inmobiliaria: extracted.inmueble.matricula_inmobiliaria,
          direccion_inmueble: extracted.inmueble.direccion_completa,
          ciudad_inmueble: extracted.inmueble.ciudad,
          deudor_nombre: extracted.partes.deudor_nombre,
          deudor_cedula: extracted.partes.deudor_identificacion,
          deudor_tipo_id: extracted.partes.deudor_tipo_id,
          banco_acreedor: extracted.partes.banco_acreedor,
          banco_nit: extracted.partes.banco_nit,
          aplica_ley_546: extracted.analisis_legal.aplica_ley_546,
          explicacion_ley: extracted.analisis_legal.explicacion_ley,
          url_minuta_generada: minutaOutputPath,
          url_certificado_generado: certOutputPath,
          updated_at: new Date().toISOString(),
        }).eq("id", cancelacionId);
        if (updErr) throw new Error(`Persist: ${updErr.message}`);
      } catch (bgErr) {
        const msg = bgErr instanceof Error ? bgErr.message : String(bgErr);
        console.error("[procesar-cancelacion bg] error:", msg);
        try {
          await supabaseService.rpc("restore_credit", { org_id: orgId });
          await supabaseService.rpc("restore_credit", { org_id: orgId });
        } catch (_) { /* ignore */ }
        await supabaseService.from("cancelaciones").update({
          status: "error", error_message: msg.slice(0, 500),
        }).eq("id", cancelacionId);
      }
    };

    // @ts-ignore EdgeRuntime global disponible en Supabase Edge Functions
    EdgeRuntime.waitUntil(heavyWork());

    return new Response(JSON.stringify({ ok: true, cancelacionId, async: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[procesar-cancelacion] error:", msg);

    // Restaurar créditos internos (2) — siempre que no haya sido credits_blocked
    try {
      await supabaseService.rpc("restore_credit", { org_id: orgId });
      await supabaseService.rpc("restore_credit", { org_id: orgId });
    } catch (_) { /* ignore */ }

    await supabaseService.from("cancelaciones").update({
      status: "error", error_message: msg.slice(0, 500),
    }).eq("id", cancelacionId);

    // Mapeo de errores del AI Gateway → envelope de negocio (HTTP 200)
    if (err instanceof AiGatewayError) {
      if (err.status === 402) {
        return biz("ai_gateway_no_credits",
          "El servicio de IA no tiene créditos disponibles. Contacta al administrador del workspace para recargar.");
      }
      if (err.status === 429) {
        return biz("ai_gateway_rate_limit",
          "Demasiadas solicitudes al servicio de IA. Espera unos minutos e intenta de nuevo.");
      }
      if (err.status === 502) {
        return biz("ai_gateway_bad_response",
          "La IA no devolvió datos estructurados válidos. Intenta nuevamente con los mismos documentos.");
      }
      return biz("ai_gateway_error", `Error del servicio de IA (${err.status}). Intenta de nuevo.`);
    }

    return biz("internal", msg.slice(0, 300));
  }
});
