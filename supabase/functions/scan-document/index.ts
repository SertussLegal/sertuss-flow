import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Confidence wrapper helper ──
// Each extracted field now returns { valor, confianza } where confianza ∈ { alta, media, baja }

const toolsByCedula = [
  {
    type: "function" as const,
    function: {
      name: "extract_cedula",
      description: "Extrae los datos de una cédula de ciudadanía colombiana a partir de la imagen. Cada campo incluye un nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          nombre_completo: {
            type: "object",
            properties: {
              valor: { type: "string", description: "Nombre completo tal como aparece en la cédula" },
              confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza de la extracción" },
            },
            required: ["valor", "confianza"],
            additionalProperties: false,
          },
          numero_cedula: {
            type: "object",
            properties: {
              valor: { type: "string", description: "Número de cédula sin puntos ni separadores" },
              confianza: { type: "string", enum: ["alta", "media", "baja"] },
            },
            required: ["valor", "confianza"],
            additionalProperties: false,
          },
          municipio_expedicion: {
            type: "object",
            properties: {
              valor: { type: "string", description: "Municipio de expedición de la cédula" },
              confianza: { type: "string", enum: ["alta", "media", "baja"] },
            },
            required: ["valor", "confianza"],
            additionalProperties: false,
          },
        },
        required: ["nombre_completo", "numero_cedula", "municipio_expedicion"],
        additionalProperties: false,
      },
    },
  },
];

const confField = (desc: string) => ({
  type: "object",
  properties: {
    valor: { type: "string", description: desc },
    confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza" },
  },
  required: ["valor", "confianza"],
  additionalProperties: false,
});

const confBoolField = (desc: string) => ({
  type: "object",
  properties: {
    valor: { type: "boolean", description: desc },
    confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza" },
  },
  required: ["valor", "confianza"],
  additionalProperties: false,
});

const toolsByCertificado = [
  {
    type: "function" as const,
    function: {
      name: "extract_certificado_tradicion",
      description: "Extrae los datos principales de un certificado de tradición y libertad colombiano, estructurados en tres nodos: documento, inmueble y personas. Cada campo tiene un nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          documento: {
            type: "object",
            description: "Datos del documento o escritura de origen",
            properties: {
              fecha_documento: confField("Fecha del documento o escritura (DD-MM-AAAA)"),
              notaria_origen: confField("Notaría de origen del documento"),
              numero_escritura: confField("Número de escritura pública"),
            },
            required: ["fecha_documento", "notaria_origen", "numero_escritura"],
            additionalProperties: false,
          },
          inmueble: {
            type: "object",
            description: "Datos del inmueble",
            properties: {
              matricula_inmobiliaria: confField("Número de matrícula inmobiliaria"),
              codigo_orip: confField("Código o nombre de la Oficina de Registro (ORIP)"),
              direccion: confField("Dirección del inmueble"),
              municipio: confField("Municipio del inmueble"),
              departamento: confField("Departamento del inmueble"),
              linderos: confField("Linderos completos del inmueble, transcribir textualmente"),
              nupre: confField("Código NUPRE/CHIP del inmueble (suele comenzar con AAA, ej: AAA0216ZOWF)"),
              area_construida: confField("Área construida del inmueble en m² (CONST), dejar vacío si no aparece"),
              area_privada: confField("Área privada del inmueble en m² (PRIV), dejar vacío si no aparece"),
              tipo_predio: confField("Tipo de predio: 'urbano' o 'rural'"),
              es_propiedad_horizontal: confBoolField("true si el inmueble tiene reglamento de propiedad horizontal"),
              escritura_constitucion_ph: confField("Número de escritura de constitución de propiedad horizontal, si aplica"),
              reformas_ph: confField("Reformas al reglamento de propiedad horizontal, si aplica"),
            },
            required: ["matricula_inmobiliaria", "codigo_orip", "linderos"],
            additionalProperties: false,
          },
          personas: {
            type: "array",
            description: "Lista de todas las personas o entidades que aparecen en el certificado",
            items: {
              type: "object",
              properties: {
                nombre_completo: { type: "string", description: "Nombre completo de la persona o razón social" },
                numero_identificacion: { type: "string", description: "Número de cédula o NIT" },
                tipo_identificacion: { type: "string", description: "Tipo de documento: CC, NIT, CE, etc." },
                lugar_expedicion: { type: "string", description: "Lugar de expedición del documento" },
                confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Confianza en la extracción de esta persona" },
              },
              required: ["nombre_completo", "numero_identificacion", "confianza"],
              additionalProperties: false,
            },
          },
        },
        required: ["documento", "inmueble", "personas"],
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
      description: "Extrae datos de un documento predial o boletín catastral colombiano. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          chip_nupre: confField("CHIP o NUPRE del inmueble (código alfanumérico que comienza con AAA, exclusivo de Bogotá). NO es la cédula catastral."),
          cedula_catastral: confField("Cédula catastral numérica del predio (~20-30 dígitos). NO es el CHIP/NUPRE. Ejemplo: 001101065800709005"),
          identificador_predial: confField("Identificador predial si no se puede clasificar como CHIP ni cédula catastral"),
          avaluo_catastral: confField("Valor del avalúo catastral en pesos colombianos"),
          area: confField("Área del predio en m²"),
          direccion: confField("Dirección del predio"),
          numero_recibo: confField("Número del recibo de pago del impuesto predial"),
          anio_gravable: confField("Año gravable del impuesto predial"),
          valor_pagado: confField("Valor total pagado del impuesto predial en pesos colombianos"),
          estrato: confField("Estrato socioeconómico del predio (1-6)"),
        },
        required: ["avaluo_catastral"],
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
      description: "Extrae los linderos de una escritura pública antecedente colombiana. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          linderos_especiales: confField("Linderos especiales (particulares) del inmueble, transcribir textualmente cada palabra"),
          linderos_generales: confField("Linderos generales del edificio o conjunto (aplica si es propiedad horizontal), transcribir textualmente"),
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
      description: "Extrae datos del poder otorgado por una entidad bancaria. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          entidad_bancaria: confField("Nombre de la entidad bancaria"),
          apoderado_nombre: confField("Nombre completo del apoderado del banco"),
          apoderado_cedula: confField("Número de cédula del apoderado del banco"),
          apoderado_expedida_en: confField("Lugar de expedición de la cédula del apoderado"),
          escritura_poder_num: confField("Número de la escritura pública del poder"),
          fecha_poder: confField("Fecha de otorgamiento del poder (DD-MM-AAAA)"),
          notaria_poder: confField("Nombre o número de la notaría donde se otorgó el poder"),
          notaria_poder_ciudad: confField("Ciudad de la notaría donde se otorgó el poder"),
          apoderado_email: confField("Correo electrónico del apoderado, si aparece"),
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
      description: "Extrae el valor del crédito hipotecario de una carta de aprobación. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          valor_credito: confField("Valor aprobado del crédito hipotecario en pesos colombianos"),
          entidad_bancaria: confField("Nombre de la entidad bancaria que otorga el crédito"),
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

const baseSystemPrompts: Record<DocType, string> = {
  cedula: `Eres un sistema OCR especializado en cédulas de ciudadanía colombianas. Analiza la imagen proporcionada y extrae el nombre completo, número de cédula y municipio de expedición. Sé preciso con los números y nombres.

CONFIANZA: Para cada campo, asigna un nivel de confianza:
- "alta": el dato es claramente legible y no hay ambigüedad
- "media": el dato es parcialmente legible o podría tener variaciones menores
- "baja": el dato es difícil de leer, está borroso, o podrías estar equivocado`,

  certificado_tradicion: `Eres un sistema OCR especializado en certificados de tradición y libertad colombianos. Analiza el documento y extrae los datos estructurados en tres nodos:

1. DOCUMENTO: fecha del documento o escritura de origen, notaría de origen, número de escritura pública.

2. INMUEBLE: matrícula inmobiliaria, ORIP, dirección, municipio, departamento, linderos completos (transcribir TEXTUALMENTE cada palabra), NUPRE/CHIP (código que suele comenzar con AAA), áreas (diferencia entre construida CONST y privada PRIV), tipo de predio, y si tiene propiedad horizontal con su escritura de constitución y reformas.

3. PERSONAS: TODAS las personas y entidades que aparecen en el certificado (propietarios actuales, anteriores, acreedores hipotecarios, constructoras, bancos, etc.). Para cada una extrae: nombre completo o razón social, número de identificación (cédula o NIT), tipo de identificación (CC, NIT, CE), y lugar de expedición.

IMPORTANTE: Los linderos son críticos — transcribe CADA PALABRA tal como aparece. No inventes datos que no aparezcan en el documento. Extrae TODAS las personas mencionadas, no solo los propietarios actuales.

LÓGICA LEGAL (Compraventa):
- La matrícula inmobiliaria es OBLIGATORIA
- El identificador predial (cédula catastral de 30 dígitos) es OBLIGATORIO — busca el campo "Cédula Catastral" o "Número Predial Nacional"
- El CHIP/NUPRE (código alfanumérico que comienza con AAA, exclusivo de Bogotá) es un campo SEPARADO de la cédula catastral. NO los confundas.
- Los linderos son OBLIGATORIOS — transcripción literal completa
- Si el inmueble es propiedad horizontal, DEBES buscar y extraer: escritura de constitución PH y reformas PH

CONFIANZA: Para cada campo, asigna un nivel de confianza:
- "alta": el dato es claramente legible y no hay ambigüedad
- "media": el dato es parcialmente legible o podría tener variaciones menores  
- "baja": el dato es difícil de leer, está borroso, o podrías estar equivocado. Si no encuentras un dato obligatorio, márcalo con confianza "baja"`,

  predial: `Eres un sistema OCR especializado en documentos prediales y boletines catastrales colombianos. Extrae TODOS los datos disponibles.

DISTINCIÓN LEGAL CRÍTICA:
- CHIP (NUPRE): Código alfanumérico que SIEMPRE comienza con "AAA" (ej: AAA0264SBWW). Es EXCLUSIVO de Bogotá D.C. y lo asigna la Unidad Administrativa Especial de Catastro Distrital.
- Cédula catastral: Código NUMÉRICO largo de ~20-30 dígitos (ej: 001101065800709005). Es el identificador catastral nacional.
- Estos son DOS campos DISTINTOS. NUNCA confundir uno con otro.

Extrae: CHIP/NUPRE (si existe), cédula catastral (si existe), avalúo catastral, área, dirección, número de recibo de pago, año gravable, valor pagado y estrato socioeconómico.

CONFIANZA: Para cada campo, asigna un nivel de confianza:
- "alta": el dato es claramente legible
- "media": parcialmente legible
- "baja": difícil de leer o ambiguo`,

  escritura_antecedente: `Eres un sistema OCR especializado en escrituras públicas colombianas. Extrae los linderos del inmueble de la escritura antecedente. Diferencia entre linderos especiales (del inmueble particular) y linderos generales (del edificio o conjunto). Transcribe TEXTUALMENTE cada lindero, palabra por palabra.

CONFIANZA: Para cada campo, asigna un nivel de confianza:
- "alta": el dato es claramente legible
- "media": parcialmente legible
- "baja": difícil de leer o ambiguo`,

  poder_banco: `Eres un sistema OCR especializado en documentos legales bancarios colombianos. Analiza el poder otorgado por una entidad bancaria y extrae TODOS los datos disponibles: nombre de la entidad bancaria, nombre completo del apoderado, número de cédula, lugar de expedición de la cédula, número de escritura pública del poder, fecha de otorgamiento, nombre/número de la notaría del poder, ciudad de la notaría, y correo electrónico del apoderado (si aparece).

CONFIANZA: Para cada campo, asigna un nivel de confianza: "alta", "media" o "baja".`,

  carta_credito: `Eres un sistema OCR especializado en documentos bancarios colombianos. Analiza la carta de aprobación de crédito hipotecario y extrae el valor aprobado del crédito y la entidad bancaria.

CONFIANZA: Para cada campo, asigna un nivel de confianza: "alta", "media" o "baja".`,
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

    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: baseSystemPrompts[type] },
        {
          role: "user",
          content: [
            { type: "text", text: "Analiza esta imagen y extrae los datos solicitados. Asigna un nivel de confianza a cada campo." },
            { type: "image_url", image_url: { url: imageDataUri } },
          ],
        },
      ],
      tools,
      tool_choice: { type: "function", function: { name: toolName } },
    });

    const aiHeaders = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    };

    // Retry up to 2 times on transient errors (503, 502, 429)
    let response: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: aiHeaders,
        body: aiBody,
      });
      if (response.ok || (response.status !== 503 && response.status !== 502)) break;
      await response.text(); // consume body
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de solicitudes excedido. Intenta de nuevo en unos minutos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados. Contacta al administrador." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Error al procesar documento con IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    // Log to system_events
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await sb.from("system_events").insert({
        evento: "scan-document",
        resultado: "error",
        categoria: "edge_function",
        detalle: { message: e instanceof Error ? e.message : "Unknown", stack: e instanceof Error ? e.stack?.slice(0, 500) : null },
      });
    } catch { /* never break main flow */ }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
