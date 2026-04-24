import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ValidacionRequest {
  modo: "campos" | "documento";
  tramite_id: string;
  organization_id: string;
  tipo_acto: string;
  tab_origen?: string;
  datos_extraidos: Record<string, any>;
  correcciones_gemini?: Array<{
    campo: string;
    original: string;
    corregido: string;
    razon: string;
  }>;
  validaciones_app?: string[];
  texto_preview?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const startTime = Date.now();
    const payload: ValidacionRequest = await req.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Leer reglas activas para este tipo de acto y momento
    const { data: reglas, error: reglasError } = await supabase
      .from("reglas_validacion")
      .select("*")
      .eq("activa", true)
      .or(`tipo_acto.cs.{${payload.tipo_acto}},tipo_acto.cs.{todos}`)
      .contains("aplica_a_momento", [payload.modo]);

    if (reglasError) throw new Error(`Error leyendo reglas: ${reglasError.message}`);

    // 2. Leer configuración de la notaría
    const { data: configNotaria } = await supabase
      .from("configuracion_notaria")
      .select("*")
      .eq("organization_id", payload.organization_id)
      .eq("activa", true)
      .single();

    // 3. Leer plantilla de validación para este tipo de acto
    const { data: plantilla } = await supabase
      .from("plantillas_validacion")
      .select("*")
      .eq("tipo_acto", payload.tipo_acto)
      .eq("activa", true)
      .single();

    // 4. Construir el prompt
    const systemPrompt = construirSystemPrompt(reglas || [], configNotaria, plantilla);
    const userPrompt = construirUserPrompt(payload);

    // 5. Llamar a Claude API
    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeResponse) {
      return new Response(
        JSON.stringify({ error: "Claude API no respondió" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const claudeData = await claudeResponse.json();

    if (!claudeResponse.ok) {
      // Surface upstream quota / rate-limit errors to the client
      if (claudeResponse.status === 402 || claudeResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: claudeData?.error?.message ?? "Cuota agotada" }),
          { status: claudeResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Claude API error: ${JSON.stringify(claudeData)}`);
    }

    // 6. Parsear la respuesta de Claude
    const respuestaTexto = claudeData.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("");

    let respuestaParsed;
    try {
      const cleanJson = respuestaTexto.replace(/```json\n?|```\n?/g, "").trim();
      respuestaParsed = JSON.parse(cleanJson);
    } catch {
      respuestaParsed = {
        estado: "error_parsing",
        puntuacion: null,
        validaciones: [],
        retroalimentacion_general: respuestaTexto,
      };
    }

    // 7. Guardar en historial
    const tiempoRespuesta = Date.now() - startTime;
    const tokensInput = claudeData.usage?.input_tokens || 0;
    const tokensOutput = claudeData.usage?.output_tokens || 0;
    const costoEstimado = (tokensInput * 3) / 1000000 + (tokensOutput * 15) / 1000000;

    await supabase.from("historial_validaciones").insert({
      tramite_id: payload.tramite_id,
      organization_id: payload.organization_id,
      tipo_acto: payload.tipo_acto,
      momento: payload.modo,
      tab_origen: payload.tab_origen || null,
      datos_enviados: payload.datos_extraidos,
      respuesta_claude: respuestaParsed,
      total_errores:
        respuestaParsed.validaciones?.filter((v: any) => v.nivel === "error").length || 0,
      total_advertencias:
        respuestaParsed.validaciones?.filter((v: any) => v.nivel === "advertencia").length || 0,
      total_sugerencias:
        respuestaParsed.validaciones?.filter((v: any) => v.nivel === "sugerencia").length || 0,
      puntuacion: respuestaParsed.puntuacion || null,
      tiempo_respuesta_ms: tiempoRespuesta,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      costo_estimado_usd: costoEstimado,
    });

    // 8. Devolver respuesta
    return new Response(JSON.stringify(respuestaParsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error en validar-con-claude:", error);
    // Log to system_events
    try {
      const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await sbAdmin.from("system_events").insert({
        evento: "validar-con-claude",
        resultado: "error",
        categoria: "edge_function",
        detalle: { message: error instanceof Error ? error.message : "Unknown" },
      });
    } catch { /* never break main flow */ }
    return new Response(
      JSON.stringify({
        estado: "error_sistema",
        mensaje: error instanceof Error ? error.message : "Unknown error",
        validaciones: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================
// FUNCIONES AUXILIARES
// ============================================

function construirSystemPrompt(
  reglas: any[],
  configNotaria: any | null,
  plantilla: any | null
): string {
  const reglasTexto = reglas
    .map(
      (r) =>
        `- [${r.codigo}] (${r.nivel_severidad}${r.auto_corregible ? ", auto-corregible" : ""}): ${r.regla_detalle}`
    )
    .join("\n");

  const notariaTexto = configNotaria
    ? `Notaría ${configNotaria.numero_notaria} del Círculo de ${configNotaria.circulo}, Departamento de ${configNotaria.departamento}. Notario: ${configNotaria.nombre_notario || "No especificado"}. Tipo: ${configNotaria.tipo_notario || "No especificado"}.`
    : "No hay configuración de notaría disponible. Validar con reglas generales.";

  const plantillaTexto = plantilla
    ? `Tipo de acto: ${plantilla.nombre_acto} (${plantilla.codigo_acto})\nCampos requeridos: ${JSON.stringify(plantilla.campos_requeridos)}\nRelaciones entre campos: ${JSON.stringify(plantilla.relaciones_entre_campos)}`
    : "No hay plantilla específica. Validar con reglas generales.";

  return `Eres el auditor senior de documentos notariales de Sertuss, una plataforma tecnológica para notarías en Colombia. Tu trabajo es revisar datos extraídos por OCR de documentos notariales y validar que sean correctos, coherentes y legalmente válidos.

PRINCIPIOS FUNDAMENTALES:
1. NUNCA contradices correcciones que ya fueron aplicadas por el sistema anterior (Gemini). Si se te informa que una corrección ya fue hecha, la respetas.
2. NUNCA modificas datos directamente. Solo reportas observaciones con el formato especificado.
3. Tu rol es COMPLEMENTAR la validación existente, no reemplazarla. Si se te informa que una validación ya fue hecha por la aplicación, no la repites.
4. Respondes SIEMPRE en español.
5. Respondes SIEMPRE en formato JSON válido, sin texto adicional fuera del JSON.

CONTEXTO DE LA NOTARÍA:
${notariaTexto}

PLANTILLA DEL TIPO DE ACTO:
${plantillaTexto}

REGLAS DE VALIDACIÓN ACTIVAS:
${reglasTexto}

FORMATO DE RESPUESTA OBLIGATORIO:
{
  "estado": "aprobado" | "requiere_revision" | "errores_criticos",
  "puntuacion": [0-100, donde 100 es perfecto],
  "validaciones": [
    {
      "nivel": "error" | "advertencia" | "sugerencia",
      "codigo_regla": "[código de la regla aplicada o 'CUSTOM' si es observación propia]",
      "campo": "[ruta del campo afectado]",
      "campos_relacionados": ["[otros campos involucrados]"],
      "valor_actual": "[valor encontrado]",
      "valor_sugerido": "[valor corregido, solo si auto_corregible]",
      "explicacion": "[explicación clara en español de por qué está mal y qué hacer]",
      "auto_corregible": true | false
    }
  ],
  "retroalimentacion_general": "[resumen ejecutivo del estado del trámite, en 2-3 oraciones máximo]"
}

REGLAS ADICIONALES PARA LA RESPUESTA:
- Si no hay ningún problema, devuelve estado "aprobado" con puntuacion 100 y validaciones vacías.
- La puntuacion se calcula: empieza en 100, resta 15 por cada error, 5 por cada advertencia, 1 por cada sugerencia.
- La explicacion debe ser útil para un funcionario de notaría: clara, concreta, con la referencia legal si aplica.
- No inventes problemas que no existan. Si todo está bien, dilo.
- Si detectas algo que no está cubierto por las reglas pero que es claramente incorrecto o sospechoso, repórtalo con codigo_regla "CUSTOM".

DATOS DE NOTARÍA EN DOCUMENTOS CARGADOS (importante):
Cuando detectes datos de notaría (número, círculo, nombre del notario, decreto, tipo titular/encargado/interino, departamento, género) en cualquier documento cargado (escritura previa, certificado de tradición, poder, etc.), repórtalos como sugerencias con:
  - "nivel": "sugerencia"
  - "auto_corregible": true
  - "campo": "notaria_tramite.<nombre>" donde <nombre> es uno de: numero_notaria, numero_notaria_letras, numero_ordinal, circulo, departamento, nombre_notario, tipo_notario, decreto_nombramiento, genero_notario.
  - "valor_sugerido": el valor extraído (string).
NO los reportes como errores: el usuario puede no querer usar esa notaría para este trámite. Son SOLO sugerencias para que el usuario las acepte con un clic.`;
}

function construirUserPrompt(payload: ValidacionRequest): string {
  let prompt = `MODO: ${payload.modo === "campos" ? "Validación de campos (tab: " + payload.tab_origen + ")" : "Validación de documento completo"}\n\n`;

  prompt += `TIPO DE ACTO: ${payload.tipo_acto}\n\n`;

  prompt += `DATOS EXTRAÍDOS POR OCR:\n${JSON.stringify(payload.datos_extraidos, null, 2)}\n\n`;

  if (payload.correcciones_gemini && payload.correcciones_gemini.length > 0) {
    prompt += `CORRECCIONES YA APLICADAS POR EL SISTEMA (NO contradecir):\n${JSON.stringify(payload.correcciones_gemini, null, 2)}\n\n`;
  }

  if (payload.validaciones_app && payload.validaciones_app.length > 0) {
    prompt += `VALIDACIONES YA REALIZADAS POR LA APLICACIÓN (NO repetir):\n${payload.validaciones_app.join("\n")}\n\n`;
  }

  if (payload.modo === "documento" && payload.texto_preview) {
    prompt += `TEXTO DEL DOCUMENTO GENERADO PARA REVISIÓN:\n${payload.texto_preview}\n\n`;
  }

  prompt += `Analiza los datos anteriores aplicando las reglas de validación activas. Responde SOLO con el JSON en el formato especificado.`;

  return prompt;
}
