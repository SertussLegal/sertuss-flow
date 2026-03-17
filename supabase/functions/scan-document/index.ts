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
      description: "Extrae los datos principales de un certificado de tradición y libertad colombiano, incluyendo información de propiedad horizontal si aplica.",
      parameters: {
        type: "object",
        properties: {
          matricula_inmobiliaria: { type: "string", description: "Número de matrícula inmobiliaria" },
          codigo_orip: { type: "string", description: "Código o nombre de la Oficina de Registro (ORIP)" },
          direccion: { type: "string", description: "Dirección del inmueble" },
          municipio: { type: "string", description: "Municipio del inmueble" },
          departamento: { type: "string", description: "Departamento del inmueble" },
          linderos: { type: "string", description: "Linderos completos del inmueble, transcribir textualmente" },
          nupre: { type: "string", description: "Código NUPRE del inmueble si aparece (suele comenzar con AAA, ej: AAA0216ZOWF)" },
          area_construida: { type: "string", description: "Área construida del inmueble en m² (CONST), dejar vacío si no aparece" },
          area_privada: { type: "string", description: "Área privada del inmueble en m² (PRIV), dejar vacío si no aparece" },
          tipo_predio: { type: "string", description: "Tipo de predio: 'urbano' o 'rural'" },
          es_propiedad_horizontal: { type: "boolean", description: "true si el inmueble tiene reglamento de propiedad horizontal" },
          escritura_constitucion_ph: { type: "string", description: "Número de escritura de constitución de propiedad horizontal, si aplica" },
          reformas_ph: { type: "string", description: "Reformas al reglamento de propiedad horizontal, si aplica" },
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

const toolsByEscritura = [
  {
    type: "function" as const,
    function: {
      name: "extract_escritura_antecedente",
      description: "Extrae los linderos de una escritura pública antecedente colombiana.",
      parameters: {
        type: "object",
        properties: {
          linderos_especiales: { type: "string", description: "Linderos especiales (particulares) del inmueble, transcribir textualmente cada palabra" },
          linderos_generales: { type: "string", description: "Linderos generales del edificio o conjunto (aplica si es propiedad horizontal), transcribir textualmente" },
        },
        required: ["linderos_especiales"],
        additionalProperties: false,
      },
    },
  },
];

const toolsByPoderBanco = [
  {
    type: "function" as const,
    function: {
      name: "extract_poder_banco",
      description: "Extrae datos del poder otorgado por una entidad bancaria a su apoderado para escrituración.",
      parameters: {
        type: "object",
        properties: {
          entidad_bancaria: { type: "string", description: "Nombre de la entidad bancaria" },
          apoderado_nombre: { type: "string", description: "Nombre completo del apoderado del banco" },
          apoderado_cedula: { type: "string", description: "Número de cédula del apoderado del banco" },
        },
        required: ["entidad_bancaria", "apoderado_nombre", "apoderado_cedula"],
        additionalProperties: false,
      },
    },
  },
];

const toolsByCartaCredito = [
  {
    type: "function" as const,
    function: {
      name: "extract_carta_credito",
      description: "Extrae el valor del crédito hipotecario de una carta de aprobación de crédito.",
      parameters: {
        type: "object",
        properties: {
          valor_credito: { type: "string", description: "Valor aprobado del crédito hipotecario en pesos colombianos" },
          entidad_bancaria: { type: "string", description: "Nombre de la entidad bancaria que otorga el crédito" },
        },
        required: ["valor_credito"],
        additionalProperties: false,
      },
    },
  },
];

type DocType = "cedula" | "certificado_tradicion" | "predial" | "escritura_antecedente" | "poder_banco" | "carta_credito";

const toolsMap: Record<DocType, { tools: any[]; toolName: string }> = {
  cedula: { tools: toolsByCedula, toolName: "extract_cedula" },
  certificado_tradicion: { tools: toolsByCertificado, toolName: "extract_certificado_tradicion" },
  predial: { tools: toolsByPredial, toolName: "extract_predial" },
  escritura_antecedente: { tools: toolsByEscritura, toolName: "extract_escritura_antecedente" },
  poder_banco: { tools: toolsByPoderBanco, toolName: "extract_poder_banco" },
  carta_credito: { tools: toolsByCartaCredito, toolName: "extract_carta_credito" },
};

const systemPrompts: Record<DocType, string> = {
  cedula: `Eres un sistema OCR especializado en cédulas de ciudadanía colombianas. Analiza la imagen proporcionada y extrae el nombre completo, número de cédula y municipio de expedición. Sé preciso con los números y nombres.`,
  certificado_tradicion: `Eres un sistema OCR especializado en certificados de tradición y libertad colombianos. Analiza el documento escaneado y extrae todos los datos del inmueble: matrícula inmobiliaria, ORIP, dirección, linderos completos (transcribir textualmente tal cual aparecen), municipio, departamento, tipo de predio y propietarios actuales. Los linderos son críticos: transcribe CADA PALABRA tal como aparece en el documento. Además, identifica si el inmueble tiene reglamento de propiedad horizontal: si lo tiene, extrae el número de escritura de constitución y las reformas. IMPORTANTE sobre NUPRE: si el certificado tiene un campo NUPRE (código que suele comenzar con AAA, por ejemplo AAA0216ZOWF), extráelo en el campo "nupre". IMPORTANTE sobre áreas: diferencia entre área construida (CONST) y área privada (PRIV). Extrae cada una por separado. Si solo aparece una de las dos, deja la otra vacía. No inventes datos que no aparezcan en el documento.`,
  predial: `Eres un sistema OCR especializado en documentos prediales y boletines catastrales colombianos. Extrae el identificador predial (CHIP o número predial nacional), avalúo catastral, área y dirección.`,
  escritura_antecedente: `Eres un sistema OCR especializado en escrituras públicas colombianas. Extrae los linderos del inmueble de la escritura antecedente. Diferencia entre linderos especiales (del inmueble particular, como apartamento o local) y linderos generales (del edificio o conjunto, aplica en propiedad horizontal). Transcribe TEXTUALMENTE cada lindero, palabra por palabra, tal cual aparece en el documento. No resumas ni parafrasees.`,
  poder_banco: `Eres un sistema OCR especializado en documentos legales bancarios colombianos. Analiza el poder otorgado por una entidad bancaria y extrae: nombre de la entidad bancaria, nombre completo del apoderado y su número de cédula.`,
  carta_credito: `Eres un sistema OCR especializado en documentos bancarios colombianos. Analiza la carta de aprobación de crédito hipotecario y extrae el valor aprobado del crédito y la entidad bancaria.`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { image, type } = await req.json() as { image: string; type: DocType };

    if (!image || !type || !toolsMap[type]) {
      return new Response(JSON.stringify({ error: "Se requiere 'image' (base64) y 'type' válido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tools, toolName } = toolsMap[type];

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

    console.log("=== SERTUSS EXTRACT: Raw AI Response ===");
    console.log(JSON.stringify(result, null, 2));

    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    console.log("=== SERTUSS EXTRACT: Tool Call ===");
    console.log("Function name:", toolCall?.function?.name);
    console.log("Arguments raw:", toolCall?.function?.arguments);

    if (!toolCall?.function?.arguments) {
      console.error("No tool call in response:", JSON.stringify(result));
      return new Response(JSON.stringify({ error: "La IA no pudo extraer datos del documento" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extractedData = JSON.parse(toolCall.function.arguments);

    console.log("=== SERTUSS EXTRACT: Parsed Data ===");
    console.log("Doc type:", type);
    console.log("Extracted fields:", Object.keys(extractedData));
    console.log("Full extracted data:", JSON.stringify(extractedData, null, 2));

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
