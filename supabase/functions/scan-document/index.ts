import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const toolsByCedula = [
  {
    type: "function" as const,
    function: {
      name: "extract_cedula",
      description: "Extrae los datos de una cédula de ciudadanía colombiana a partir de la imagen.",
      parameters: {
        type: "object",
        properties: {
          nombre_completo: { type: "string", description: "Nombre completo tal como aparece en la cédula" },
          numero_cedula: { type: "string", description: "Número de cédula sin puntos ni separadores" },
          municipio_expedicion: { type: "string", description: "Municipio de expedición de la cédula" },
        },
        required: ["nombre_completo", "numero_cedula", "municipio_expedicion"],
        additionalProperties: false,
      },
    },
  },
];

const toolsByCertificado = [
  {
    type: "function" as const,
    function: {
      name: "extract_certificado_tradicion",
      description: "Extrae los datos principales de un certificado de tradición y libertad colombiano.",
      parameters: {
        type: "object",
        properties: {
          matricula_inmobiliaria: { type: "string", description: "Número de matrícula inmobiliaria" },
          codigo_orip: { type: "string", description: "Código o nombre de la Oficina de Registro (ORIP)" },
          direccion: { type: "string", description: "Dirección del inmueble" },
          municipio: { type: "string", description: "Municipio del inmueble" },
          departamento: { type: "string", description: "Departamento del inmueble" },
          linderos: { type: "string", description: "Linderos completos del inmueble, transcribir textualmente" },
          area: { type: "string", description: "Área del inmueble en m²" },
          propietarios: {
            type: "array",
            items: {
              type: "object",
              properties: {
                nombre: { type: "string" },
                cedula: { type: "string" },
              },
              required: ["nombre"],
              additionalProperties: false,
            },
            description: "Lista de propietarios actuales",
          },
        },
        required: ["matricula_inmobiliaria", "codigo_orip", "linderos"],
        additionalProperties: false,
      },
    },
  },
];

const toolsByPredial = [
  {
    type: "function" as const,
    function: {
      name: "extract_predial",
      description: "Extrae datos de un documento predial o boletín catastral colombiano.",
      parameters: {
        type: "object",
        properties: {
          identificador_predial: { type: "string", description: "Número predial o CHIP del inmueble" },
          avaluo_catastral: { type: "string", description: "Valor del avalúo catastral en pesos colombianos" },
          area: { type: "string", description: "Área del predio en m²" },
          direccion: { type: "string", description: "Dirección del predio" },
        },
        required: ["identificador_predial", "avaluo_catastral"],
        additionalProperties: false,
      },
    },
  },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { image, type } = await req.json() as { image: string; type: "cedula" | "certificado_tradicion" | "predial" };

    if (!image || !type) {
      return new Response(JSON.stringify({ error: "Se requiere 'image' (base64) y 'type'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toolsMap = {
      cedula: { tools: toolsByCedula, toolName: "extract_cedula" },
      certificado_tradicion: { tools: toolsByCertificado, toolName: "extract_certificado_tradicion" },
      predial: { tools: toolsByPredial, toolName: "extract_predial" },
    };

    const { tools, toolName } = toolsMap[type];

    const systemPrompts: Record<string, string> = {
      cedula: `Eres un sistema OCR especializado en cédulas de ciudadanía colombianas. Analiza la imagen proporcionada y extrae el nombre completo, número de cédula y municipio de expedición. Sé preciso con los números y nombres.`,
      certificado_tradicion: `Eres un sistema OCR especializado en certificados de tradición y libertad colombianos. Analiza el documento escaneado y extrae todos los datos del inmueble: matrícula inmobiliaria, ORIP, dirección, linderos completos (transcribir textualmente tal cual aparecen), municipio, departamento, área y propietarios actuales. Los linderos son críticos: transcribe CADA PALABRA tal como aparece en el documento.`,
      predial: `Eres un sistema OCR especializado en documentos prediales y boletines catastrales colombianos. Extrae el identificador predial (CHIP o número predial nacional), avalúo catastral, área y dirección.`,
    };

    // Build multimodal message with image
    const imageDataUri = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompts[type] },
          {
            role: "user",
            content: [
              { type: "text", text: "Analiza esta imagen y extrae los datos solicitados." },
              { type: "image_url", image_url: { url: imageDataUri } },
            ],
          },
        ],
        tools,
        tool_choice: { type: "function", function: { name: toolName } },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de solicitudes excedido. Intenta de nuevo en unos minutos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados. Contacta al administrador." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Error al procesar documento con IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error("No tool call in response:", JSON.stringify(result));
      return new Response(JSON.stringify({ error: "La IA no pudo extraer datos del documento" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extractedData = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ data: extractedData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-document error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
