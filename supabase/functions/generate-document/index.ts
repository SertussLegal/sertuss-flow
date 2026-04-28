import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchAiGateway, aiGatewayErrorResponse, parseToolCallArguments } from "../_shared/aiFetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { vendedores, compradores, inmueble, actos, notaria_tramite } = await req.json();

    const BLANK = "___________";
    const ntVal = (key: string) => {
      const raw = notaria_tramite && typeof notaria_tramite === "object" ? notaria_tramite[key] : "";
      const s = (raw ?? "").toString().trim();
      return s.length > 0 ? s : BLANK;
    };
    const notariaBlock = `DATOS DE LA NOTARÍA PARA ESTE TRÁMITE:
Número: ${ntVal("numero_notaria")} (${ntVal("numero_notaria_letras")})
Ordinal: ${ntVal("numero_ordinal")}
Círculo: ${ntVal("circulo")}
Departamento: ${ntVal("departamento")}
Notario: ${ntVal("nombre_notario")}
Tipo: ${ntVal("tipo_notario")}
Decreto: ${ntVal("decreto_nombramiento")}
Género: ${ntVal("genero_notario")}

REGLA CRÍTICA: Usa estos datos en TODAS las referencias a la notaría. Si algún campo aparece como "___________" arriba, debes devolver "___________" en los campos correspondientes del tool (notaria_numero_letras, notaria_ordinal, notaria_circulo, notario_nombre, notario_tipo, etc.). NUNCA inventes datos de notaría ni uses los de la "Notaría Quinta de Bogotá" o cualquier otra notaría real no proporcionada. Es preferible una línea en blanco a un dato inventado.`;

    const systemPrompt = `Eres un asistente jurídico experto en derecho notarial colombiano (Ley 1579 de 2012, Decreto 960 de 1970).
Tu tarea es generar el contenido legal estructurado para una escritura pública de compraventa (y posible hipoteca) a partir de los datos proporcionados.

Reglas:
- Usa lenguaje formal notarial colombiano.
- Los valores monetarios deben expresarse en letras y números (ej: "CIEN MILLONES DE PESOS M/CTE ($100.000.000)").
- Las cédulas deben formatearse con puntos de miles.
- Si hay hipoteca, incluye las cláusulas hipotecarias completas.
- Si hay afectación a vivienda familiar, incluye la cláusula correspondiente.
- Si hay apoderado, incluye la cláusula de poder.
- Si hay persona jurídica, usa la razón social y NIT en lugar de nombre y cédula.
- Si un vendedor o comprador tiene datos incompletos (sin estado civil, sin dirección, sin lugar de expedición), deja esos campos con líneas en blanco (___________) para ser llenados manualmente en la notaría. Esto es normal en el proceso notarial colombiano.`;

    const userPrompt = `Datos del trámite:

VENDEDORES:
${JSON.stringify(vendedores, null, 2)}

COMPRADORES:
${JSON.stringify(compradores, null, 2)}

INMUEBLE:
${JSON.stringify(inmueble, null, 2)}

ACTOS:
${JSON.stringify(actos, null, 2)}

${notariaBlock}

Genera el contenido legal estructurado para llenar la plantilla de escritura pública.`;

    const tools = [
      {
        type: "function",
        function: {
          name: "fill_template",
          description: "Devuelve los campos para llenar la plantilla de escritura pública de compraventa/hipoteca.",
          parameters: {
            type: "object",
            properties: {
              numero_escritura: { type: "string", description: "Número de la escritura (dejar vacío si no se conoce)" },
              fecha_escritura: { type: "string", description: "Fecha en letras, ej: 'cinco (5) de marzo de dos mil veintiséis (2026)'" },
              comparecientes_vendedor: { type: "string", description: "Texto legal completo de comparecencia de vendedor(es) con identificación" },
              comparecientes_comprador: { type: "string", description: "Texto legal completo de comparecencia de comprador(es) con identificación" },
              clausula_objeto: { type: "string", description: "Cláusula PRIMERA: objeto de la compraventa, descripción del inmueble" },
              clausula_precio: { type: "string", description: "Cláusula SEGUNDA: precio y forma de pago en letras y números" },
              clausula_tradicion: { type: "string", description: "Cláusula TERCERA: tradición y libertad del inmueble" },
              clausula_entrega: { type: "string", description: "Cláusula CUARTA: entrega material del inmueble" },
              clausula_gastos: { type: "string", description: "Cláusula QUINTA: gastos notariales y de registro" },
              clausula_hipoteca: { type: "string", description: "Cláusula de constitución de hipoteca (vacío si no aplica)" },
              clausula_afectacion_vivienda: { type: "string", description: "Cláusula de afectación a vivienda familiar (vacío si no aplica)" },
              clausula_apoderado: { type: "string", description: "Cláusula de poder (vacío si no aplica)" },
              matricula_inmobiliaria: { type: "string", description: "Número de matrícula inmobiliaria" },
              identificador_predial: { type: "string", description: "Número de identificador predial" },
              direccion_inmueble: { type: "string", description: "Dirección completa del inmueble" },
              municipio: { type: "string", description: "Municipio del inmueble" },
              departamento: { type: "string", description: "Departamento del inmueble" },
              linderos: { type: "string", description: "Linderos del inmueble" },
              area: { type: "string", description: "Área del inmueble" },
              valor_compraventa_letras: { type: "string", description: "Valor de compraventa en letras y números" },
              valor_hipoteca_letras: { type: "string", description: "Valor de hipoteca en letras y números (vacío si no aplica)" },
              entidad_bancaria: { type: "string", description: "Nombre de la entidad bancaria (vacío si no aplica)" },
              notaria_numero: { type: "string", description: "Número de la notaría destino. Devuelve '___________' si no fue proporcionado." },
              notaria_numero_letras: { type: "string", description: "Número de la notaría en letras (ej: QUINTA, VEINTIUNA). Devuelve '___________' si no fue proporcionado." },
              notaria_ordinal: { type: "string", description: "Ordinal del notario (ej: QUINTO, VEINTIUNO). Devuelve '___________' si no fue proporcionado." },
              notaria_circulo: { type: "string", description: "Círculo notarial (ej: BOGOTÁ D.C.). Devuelve '___________' si no fue proporcionado." },
              notaria_departamento: { type: "string", description: "Departamento de la notaría. Devuelve '___________' si no fue proporcionado." },
              notario_nombre: { type: "string", description: "Nombre completo del notario titular/encargado. Devuelve '___________' si no fue proporcionado." },
              notario_tipo: { type: "string", description: "Tipo de notario (titular, encargado, interino). Devuelve '___________' si no fue proporcionado." },
              notario_decreto: { type: "string", description: "Decreto de nombramiento del notario. Devuelve '___________' si no fue proporcionado." },
            },
            required: [
              "fecha_escritura", "comparecientes_vendedor", "comparecientes_comprador",
              "clausula_objeto", "clausula_precio", "clausula_tradicion",
              "clausula_entrega", "clausula_gastos", "matricula_inmobiliaria",
              "identificador_predial", "direccion_inmueble", "municipio",
              "departamento", "valor_compraventa_letras"
            ],
            additionalProperties: false,
          },
        },
      },
    ];

    let response: Response;
    try {
      response = await fetchAiGateway({
        apiKey: LOVABLE_API_KEY,
        body: {
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools,
          tool_choice: { type: "function", function: { name: "fill_template" } },
        },
        tag: "generate-document",
      });
    } catch (err) {
      const r = aiGatewayErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }

    let templateData: Record<string, unknown>;
    try {
      templateData = await parseToolCallArguments<Record<string, unknown>>(response, "generate-document");
    } catch (err) {
      const r = aiGatewayErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }

    return new Response(JSON.stringify({ templateData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-document error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
