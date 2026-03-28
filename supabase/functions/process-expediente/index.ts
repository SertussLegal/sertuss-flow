import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { tramite_id } = await req.json();
    if (!tramite_id) throw new Error("tramite_id requerido");

    // 1. Fetch tramite + related data in parallel
    const [tramiteRes, personasRes, inmuebleRes, actosRes] = await Promise.all([
      sb.from("tramites").select("*").eq("id", tramite_id).single(),
      sb.from("personas").select("*").eq("tramite_id", tramite_id),
      sb.from("inmuebles").select("*").eq("tramite_id", tramite_id).single(),
      sb.from("actos").select("*").eq("tramite_id", tramite_id).single(),
    ]);

    if (tramiteRes.error) throw new Error("Trámite no encontrado");
    const tramite = tramiteRes.data;

    // 2. Fetch notaria_styles + config_tramites in parallel
    const tipoActo = tramite.tipo || "Compraventa";
    const [estiloRes, configRes] = await Promise.all([
      sb.from("notaria_styles").select("*").eq("organization_id", tramite.organization_id).single(),
      sb.from("config_tramites").select("campos_obligatorios").eq("tipo_acto", tipoActo).single(),
    ]);

    const estiloNotaria = estiloRes.data;
    const camposObligatorios: string[] = configRes.data?.campos_obligatorios as string[] || [];

    // 3. Separate vendedores/compradores
    const personas = personasRes.data || [];
    const vendedores = personas.filter((p: any) => p.rol === "vendedor");
    const compradores = personas.filter((p: any) => p.rol === "comprador");

    // 4. Role validation
    const metadata = tramite.metadata as Record<string, any> || {};
    const extractedPersonas = metadata.extracted_personas || [];

    if (extractedPersonas.length > 0 && vendedores.length > 0) {
      for (const vendedor of vendedores) {
        const nameNorm = (vendedor.nombre_completo || "").toUpperCase().trim();
        const match = extractedPersonas.find((ep: any) =>
          (ep.nombre_completo || "").toUpperCase().trim() === nameNorm
        );
        if (match) {
          vendedor._certificado_match = true;
        }
      }
    }

    // 5. Build Súper-JSON
    const superJson = {
      vendedores,
      compradores,
      inmueble: inmuebleRes.data || {},
      actos: actosRes.data || {},
      estilo_notaria: estiloNotaria ? {
        nombre_notaria: estiloNotaria.nombre_notaria,
        ciudad: estiloNotaria.ciudad,
        estilo_linderos: estiloNotaria.estilo_linderos,
        notario_titular: estiloNotaria.notario_titular,
        clausulas_personalizadas: estiloNotaria.clausulas_personalizadas,
      } : null,
      custom_variables: metadata.custom_variables || [],
      campos_obligatorios: camposObligatorios,
    };

    // 6. Call SERTUSS-EDITOR-PRO via AI gateway
    const systemPrompt = buildEditorProPrompt(superJson.estilo_notaria, camposObligatorios);
    const userPrompt = `Datos del expediente notarial:\n\n${JSON.stringify(superJson, null, 2)}\n\nRedacta la escritura pública completa y señala discrepancias o ajustes de estilo.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "redactar_escritura",
          description: "Genera la escritura pública completa en HTML y señala sugerencias de la IA.",
          parameters: {
            type: "object",
            properties: {
              texto_final_word: {
                type: "string",
                description: "HTML completo de la escritura pública redactada. Usar tags <p>, <strong>, <em>. Cada cláusula en un párrafo separado."
              },
              sugerencias_ia: {
                type: "array",
                description: "Array de sugerencias/observaciones de la IA sobre el documento",
                items: {
                  type: "object",
                  properties: {
                    tipo: { type: "string", enum: ["discrepancia", "estilo"] },
                    texto_original: { type: "string", description: "Fragmento exacto del texto que se señala" },
                    texto_sugerido: { type: "string", description: "Texto corregido o mejorado" },
                    mensaje: { type: "string", description: "Explicación breve" },
                    campo: { type: "string", description: "Campo del formulario relacionado si aplica" },
                  },
                  required: ["tipo", "texto_original", "texto_sugerido", "mensaje"],
                  additionalProperties: false,
                },
              },
              numero_escritura: { type: "string" },
              fecha_escritura: { type: "string" },
              comparecientes_vendedor: { type: "string" },
              comparecientes_comprador: { type: "string" },
              clausula_objeto: { type: "string" },
              clausula_precio: { type: "string" },
              clausula_tradicion: { type: "string" },
              clausula_entrega: { type: "string" },
              clausula_gastos: { type: "string" },
              clausula_hipoteca: { type: "string" },
              clausula_afectacion_vivienda: { type: "string" },
              clausula_apoderado: { type: "string" },
              matricula_inmobiliaria: { type: "string" },
              identificador_predial: { type: "string" },
              direccion_inmueble: { type: "string" },
              municipio: { type: "string" },
              departamento: { type: "string" },
              linderos: { type: "string" },
              area: { type: "string" },
              valor_compraventa_letras: { type: "string" },
              valor_hipoteca_letras: { type: "string" },
              entidad_bancaria: { type: "string" },
            },
            required: ["texto_final_word", "sugerencias_ia", "fecha_escritura", "comparecientes_vendedor", "comparecientes_comprador", "clausula_objeto", "clausula_precio", "clausula_tradicion", "clausula_entrega", "clausula_gastos", "matricula_inmobiliaria", "identificador_predial", "direccion_inmueble", "municipio", "departamento", "valor_compraventa_letras"],
            additionalProperties: false,
          },
        },
      },
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "redactar_escritura" } },
      }),
    });

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
      return new Response(JSON.stringify({ error: "Error al generar documento con IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      console.error("No tool call in response:", JSON.stringify(result));
      return new Response(JSON.stringify({ error: "La IA no devolvió datos estructurados" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const editorResult = JSON.parse(toolCall.function.arguments);

    // 7. Save results to tramite metadata
    const updatedMetadata = {
      ...metadata,
      texto_final_word: editorResult.texto_final_word,
      sugerencias_ia: editorResult.sugerencias_ia || [],
      last_generated: new Date().toISOString(),
    };

    await sb.from("tramites").update({
      metadata: updatedMetadata,
      updated_at: new Date().toISOString(),
    }).eq("id", tramite_id);

    // 8. Insert logs_extraccion
    await sb.from("logs_extraccion").insert({
      tramite_id,
      data_ia: editorResult,
    });

    return new Response(JSON.stringify({
      texto_final_word: editorResult.texto_final_word,
      sugerencias_ia: editorResult.sugerencias_ia || [],
      templateData: editorResult,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-expediente error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function buildEditorProPrompt(estiloNotaria: any, camposObligatorios: string[]): string {
  let base = `Eres SERTUSS-EDITOR-PRO, un redactor jurídico experto en derecho notarial colombiano (Ley 1579 de 2012, Decreto 960 de 1970).

Tu tarea es:
1. Redactar la escritura pública COMPLETA en formato HTML usando los datos proporcionados
2. Identificar discrepancias entre datos (ej: una dirección en la cédula diferente a la del certificado)
3. Señalar ajustes de estilo notarial (concordancia de género, uso de protocolos, formato de linderos)

Reglas de redacción:
- Lenguaje formal notarial colombiano
- Valores monetarios en letras y números: "CIEN MILLONES DE PESOS M/CTE ($100.000.000)"
- Cédulas formateadas con puntos de miles
- Si hay hipoteca, incluir cláusulas hipotecarias completas
- Si hay afectación a vivienda familiar, incluir la cláusula correspondiente
- Si hay apoderado, incluir la cláusula de poder
- Si hay persona jurídica, usar razón social y NIT

Para las sugerencias:
- tipo "discrepancia": datos que no coinciden entre documentos (NARANJA en la UI)
- tipo "estilo": mejoras de formato, concordancia de género, protocolo notarial (AZUL en la UI)
- El campo "texto_original" DEBE existir textualmente en "texto_final_word"
- El campo "campo" debe mapear al campo del formulario cuando sea posible`;

  if (camposObligatorios.length > 0) {
    base += `\n\nCAMPOS OBLIGATORIOS para este tipo de acto: ${camposObligatorios.join(", ")}
Si alguno de estos campos está vacío o falta, genera una sugerencia de tipo "discrepancia" indicando que el campo es requerido por ley.`;
  }

  if (estiloNotaria) {
    base += `\n\nEstilo de la Notaría:
- Nombre: ${estiloNotaria.nombre_notaria}
- Ciudad: ${estiloNotaria.ciudad}
- Notario Titular: ${estiloNotaria.notario_titular}
- Estilo de Linderos: ${estiloNotaria.estilo_linderos || "estándar"}`;

    if (estiloNotaria.clausulas_personalizadas && Object.keys(estiloNotaria.clausulas_personalizadas).length > 0) {
      base += `\n- Cláusulas Personalizadas: ${JSON.stringify(estiloNotaria.clausulas_personalizadas)}`;
    }

    base += `\n\nAplica el estilo de linderos y cláusulas personalizadas de esta notaría en la redacción.`;
  }

  return base;
}
