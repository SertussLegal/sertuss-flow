import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchAiGateway, aiGatewayErrorResponse, parseToolCallArguments } from "../_shared/aiFetch.ts";
import { STRICT_OUTPUT_RULES, sanitizeAiOutput, sanitizeAiJson } from "../_shared/aiOutputRules.ts";
import { escrituraProsa, montoProsa, fechaProsa } from "./legalProse.ts";

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

    const { tramite_id, notaria_tramite } = await req.json();
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
    const notariaStyleId = tramite.notaria_style_id;
    const [estiloRes, configRes] = await Promise.all([
      notariaStyleId
        ? sb.from("notaria_styles").select("*").eq("id", notariaStyleId).single()
        : sb.from("notaria_styles").select("*").eq("organization_id", tramite.organization_id).limit(1).maybeSingle(),
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

    // 5. Build Súper-JSON con DEEP MERGE de overrides manuales del usuario
    //    Prioridad: Edición Manual (manualFieldOverrides) > OCR/BD.
    const overrides = (metadata.manualFieldOverrides as Record<string, unknown>) || {};
    const applyOverrides = <T extends Record<string, any>>(base: T, prefix: string): T => {
      const out: Record<string, any> = { ...base };
      for (const [k, v] of Object.entries(overrides)) {
        if (typeof v !== "string" || !v.trim()) continue;
        // Soporta tanto "inmueble.matricula" como "matricula".
        if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
        else if (k in out) out[k] = v;
      }
      return out as T;
    };
    const inmuebleMerged = applyOverrides(inmuebleRes.data || {}, "inmueble");
    const actosMerged = applyOverrides(actosRes.data || {}, "actos");

    const superJson = {
      vendedores,
      compradores,
      inmueble: inmuebleMerged,
      actos: actosMerged,
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

    // 5.b Pre-cómputo `prosa_helpers`: strings ya formateados que el modelo
    // debe embeber LITERALMENTE (sin alterar palabra ni puntuación).
    const prosaHelpers = buildProsaHelpers(inmuebleMerged, actosMerged, vendedores);

    // 6. Call SERTUSS-EDITOR-PRO via AI gateway
    const systemPrompt = buildEditorProPrompt(superJson.estilo_notaria, camposObligatorios);
    // Defensa server-side: hidratamos derivados si vienen vacíos del cliente.
    const hydratedNotaria = hydrateNotariaDerivados(notaria_tramite);
    const notariaBlock = buildNotariaBlock(hydratedNotaria);
    const userPrompt = `Datos del expediente notarial:\n\n${JSON.stringify(superJson, null, 2)}\n\nPROSA HELPERS PRECOMPUTADA (USAR LITERALMENTE, sin alterar palabra ni puntuación):\n${JSON.stringify(prosaHelpers, null, 2)}\n\n${notariaBlock}\n\nRedacta la escritura pública completa y señala discrepancias o ajustes de estilo.`;

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
                    tipo: { type: "string", enum: ["estilo"], description: "Solo sugerencias de estilo. Las discrepancias entre documentos las maneja el auditor (Claude), NO el redactor." },
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
            required: ["texto_final_word", "sugerencias_ia"],
            additionalProperties: false,
          },
        },
      },
    ];

    // Helper: detecta errores de timeout/saturación transitorios del gateway
    // upstream (502/504, idle timeout, empty 200). Esos sí ameritan fallback;
    // 402/429/401/400 NO (no se arreglan cambiando de modelo).
    const isUpstreamSaturationError = (err: unknown): boolean => {
      const anyErr = err as { status?: number; message?: string; rawBody?: string } | null;
      if (!anyErr) return false;
      if (anyErr.status === 502 || anyErr.status === 503 || anyErr.status === 504 || anyErr.status === 0) {
        return true;
      }
      const haystack = `${anyErr.message ?? ""} ${anyErr.rawBody ?? ""}`.toLowerCase();
      return (
        haystack.includes("idle timeout") ||
        haystack.includes("upstream timeout") ||
        haystack.includes("upstream idle") ||
        haystack.includes("empty body") ||
        haystack.includes("network connection lost") ||
        haystack.includes("exhausted retries")
      );
    };

    const callEditor = (model: string, maxRetries: number) =>
      fetchAiGateway({
        apiKey: LOVABLE_API_KEY,
        body: {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          tools,
          tool_choice: { type: "function", function: { name: "redactar_escritura" } },
        },
        maxRetries,
        tag: "process-expediente",
      });

    let response: Response;
    let modeloUtilizado = "google/gemini-2.5-pro";
    let fallbackUsed = false;
    try {
      // Intento primario: Pro con reintentos reducidos (1 retry => 2 intentos).
      response = await callEditor("google/gemini-2.5-pro", 1);
    } catch (errPro) {
      if (isUpstreamSaturationError(errPro)) {
        console.warn(
          `[process-expediente] Pro saturado, intentando fallback con Flash. status=${(errPro as { status?: number })?.status}`,
        );
        try {
          response = await callEditor("google/gemini-2.5-flash", 2);
          modeloUtilizado = "google/gemini-2.5-flash";
          fallbackUsed = true;
        } catch (errFlash) {
          // Si tanto Pro como Flash fallan por saturación, devolvemos un
          // 500 con mensaje humano. Otros errores (402/429) los pasamos al
          // helper estándar para preservar el status code original.
          const r = aiGatewayErrorResponse(errFlash, corsHeaders);
          if (r && (r.status === 402 || r.status === 429)) return r;
          console.error("[process-expediente] Pro y Flash saturados:", errFlash);
          return new Response(
            JSON.stringify({
              error:
                "El redactor IA está saturado debido al tamaño del expediente. Por favor, intenta de nuevo en unos momentos.",
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else {
        const r = aiGatewayErrorResponse(errPro, corsHeaders);
        if (r) return r;
        throw errPro;
      }
    }

    interface EditorResult {
      texto_final_word: string;
      sugerencias_ia?: unknown[];
      [k: string]: unknown;
    }

    let editorResult: EditorResult;
    let geminiUsage: { input?: number; output?: number; total?: number } = {};
    try {
      // Clonamos para extraer usage (parseToolCallArguments consume el body).
      const usageClone = response.clone();
      editorResult = await parseToolCallArguments<EditorResult>(response, "process-expediente");
      try {
        const raw = await usageClone.json() as any;
        geminiUsage = {
          input: raw?.usage?.prompt_tokens ?? raw?.usage?.input_tokens,
          output: raw?.usage?.completion_tokens ?? raw?.usage?.output_tokens,
          total: raw?.usage?.total_tokens,
        };
      } catch { /* usage es opcional */ }
    } catch (err) {
      const r = aiGatewayErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }
    

    // 7. Save results to tramite metadata (con post-proceso defensivo + sanitizer Fase 1)
    const cleanedTexto = sanitizeAiOutput(sanitizeAiText(editorResult.texto_final_word || ""));
    const cleanedSugerencias = sanitizeAiJson(editorResult.sugerencias_ia || []);
    const updatedMetadata = {
      ...metadata,
      texto_final_word: cleanedTexto,
      sugerencias_ia: cleanedSugerencias,
      last_generated: new Date().toISOString(),
    };

    await sb.from("tramites").update({
      metadata: updatedMetadata,
      updated_at: new Date().toISOString(),
    }).eq("id", tramite_id);

    // Fase 2: telemetría — tokens, longitud del documento, mix de sugerencias.
    // Coste estimado Gemini 2.5 Pro: $1.25/M input, $10/M output (referencia).
    try {
      const sugList = Array.isArray(cleanedSugerencias) ? cleanedSugerencias as any[] : [];
      const tipoCounts = sugList.reduce((acc: Record<string, number>, s) => {
        const t = String(s?.tipo ?? "desconocido");
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      }, {});
      const inT = geminiUsage.input ?? 0;
      const outT = geminiUsage.output ?? 0;
      const costoUsd = (inT * 1.25) / 1_000_000 + (outT * 10) / 1_000_000;
      await sb.from("system_events").insert({
        evento: "process-expediente",
        resultado: "success",
        categoria: "ai_metrics",
        tramite_id,
        organization_id: tramite.organization_id,
        detalle: {
          phase: "fase_2",
          model: "google/gemini-2.5-pro",
          tipo_acto: tipoActo,
          tokens_input: inT,
          tokens_output: outT,
          tokens_total: geminiUsage.total ?? (inT + outT),
          costo_usd: costoUsd,
          texto_chars: cleanedTexto.length,
          sugerencias_total: sugList.length,
          sugerencias_por_tipo: tipoCounts,
          sugerencias_discrepancia: tipoCounts["discrepancia"] ?? 0, // debe tender a 0 en Fase 2
        },
      });
    } catch { /* never break main flow */ }

    await sb.from("logs_extraccion").insert({
      tramite_id,
      data_ia: editorResult,
    });

    return new Response(JSON.stringify({
      texto_final_word: cleanedTexto,
      sugerencias_ia: cleanedSugerencias,
      templateData: { ...sanitizeAiJson(editorResult), texto_final_word: cleanedTexto, sugerencias_ia: cleanedSugerencias },
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
  let base = `Eres SERTUSS-EDITOR-PRO, redactor jurídico experto en derecho notarial colombiano (Ley 1579 de 2012, Decreto 960 de 1970).

ROL ÚNICO: REDACCIÓN.
Tu única tarea es redactar la escritura pública COMPLETA en HTML usando los datos proporcionados.
NO valides reglas de negocio. NO detectes discrepancias entre documentos. NO audites cumplimiento.
Esa labor la realiza otro sistema (auditor Claude). Si los datos están incompletos, redacta con líneas en blanco "___________" — no generes alertas.

Reglas de redacción:
- Lenguaje formal notarial colombiano.
- Valores monetarios en letras y números: "CIEN MILLONES DE PESOS M/CTE ($100.000.000)".
- Cédulas formateadas con puntos de miles.
- Si hay hipoteca, incluye cláusulas hipotecarias completas.
- Si hay afectación a vivienda familiar, incluye la cláusula correspondiente.
- Si hay apoderado, incluye la cláusula de poder.
- Si hay persona jurídica, usa razón social y NIT.

Sugerencias permitidas (campo "sugerencias_ia"):
- SOLO de tipo "estilo": concordancia de género, formato de linderos, protocolo notarial, ortografía.
- PROHIBIDO emitir sugerencias de tipo "discrepancia", "validación legal", "campos requeridos" o "cumplimiento". Esas las hace el auditor.
- "texto_original" debe existir literalmente en "texto_final_word".
- "campo" debe mapear al campo del formulario cuando aplique.

REGLA DE COLAPSO ADAPTATIVO (CRÍTICA — emula "minuta_correcta.doc"):
- PROHIBIDO escribir "[___]", "___________" o paréntesis vacíos para datos que SÍ tienes en el JSON.
- Si una sección OPCIONAL carece de datos críticos, OMÍTELA POR COMPLETO (no dejes líneas en blanco).
  Secciones colapsables: Régimen de Propiedad Horizontal, Hipoteca, Afectación a Vivienda Familiar, Apoderado.
- Para escrituras públicas, fechas y montos DEBES usar el formato letras-y-número combinado:
  · "Escritura Pública número doscientos veintidós (222) de fecha veintinueve (29) de enero de mil novecientos setenta y uno (1971) otorgada en la Notaría séptima (7) del Círculo de Bogotá D.C."
  · "CIENTO OCHENTA Y CINCO MILLONES DE PESOS ($185.000.000)"
- Cuando recibas el bloque "PROSA HELPERS PRECOMPUTADA", DEBES embeber esos strings literalmente, sin alterar ninguna palabra ni signo de puntuación.`;

  if (camposObligatorios.length > 0) {
    base += `\n\nCAMPOS OBLIGATORIOS para este tipo de acto: ${camposObligatorios.join(", ")}.
Si alguno está vacío, simplemente déjalo como "___________" en el documento. NO emitas sugerencia ni alerta — el auditor lo reportará.`;
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

  base += STRICT_OUTPUT_RULES;
  return base;
}

function buildNotariaBlock(nt: any): string {
  const BLANK = "___________";
  const raw = (key: string) => {
    const r = nt && typeof nt === "object" ? nt[key] : "";
    return (r ?? "").toString().trim();
  };
  const v = (key: string) => {
    const s = raw(key);
    return s.length > 0 ? s : BLANK;
  };
  // Solo mostrar el paréntesis con letras si EXISTEN letras; nunca "_____ (_____)".
  const num = raw("numero_notaria");
  const numLetras = raw("numero_notaria_letras");
  const numeroLine =
    numLetras.length > 0
      ? `Número: ${num.length > 0 ? num : BLANK} (${numLetras})`
      : `Número: ${num.length > 0 ? num : BLANK}`;

  return `DATOS DE LA NOTARÍA PARA ESTE TRÁMITE:
${numeroLine}
Ordinal: ${v("numero_ordinal")}
Círculo: ${v("circulo")}
Departamento: ${v("departamento")}
Notario: ${v("nombre_notario")}
Tipo: ${v("tipo_notario")}
Decreto: ${v("decreto_nombramiento")}
Género: ${v("genero_notario")}

REGLA CRÍTICA: Usa estos datos en TODAS las referencias a la notaría en el documento (encabezado, calificación, intro, cierre, pie de página). Si algún campo está vacío arriba aparece como "___________" — en ese caso debes dejar líneas en blanco (___________) en el documento. NUNCA inventes ni uses datos de una notaría específica que no fueron proporcionados (por ejemplo, NO uses "Notaría Quinta de Bogotá" ni ninguna otra notaría real). Es preferible una línea en blanco a un dato inventado.

REGLAS TIPOGRÁFICAS ESTRICTAS para los blanks "___________":
- NUNCA emitas paréntesis cuyo único contenido sea uno o más blanks. Ej. PROHIBIDO: "___________ (___________)" — usa solo "___________".
- NUNCA dupliques cierres ni aperturas de paréntesis. PROHIBIDO ")) " o "((".
- NUNCA dejes paréntesis vacíos "( )" o "()".
- Si una cifra y su versión en letras estarían ambas vacías, escribe un único "___________" sin paréntesis adicionales.`;
}

// Post-proceso defensivo: limpia paréntesis dobles/vacíos/redundantes que el modelo
// pudiera emitir alrededor de los blanks. Misma lógica espejo del Pase A en el cliente.
function sanitizeAiText(text: string): string {
  if (!text) return text;
  return text
    .replace(/\)\s*\)+/g, ")")
    .replace(/\(\s*\(+/g, "(")
    .replace(/(_{6,})\s*\(\s*_{6,}\s*\)/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1");
}

// Convierte número de notaría a letras en mayúscula (1..100). Soporte básico server-side.
function numeroNotariaToLetrasServer(n: string | number): string {
  const num = typeof n === "string" ? parseInt(n.replace(/\D/g, ""), 10) : n;
  if (!num || isNaN(num) || num < 1) return "";
  const unidades = ["", "PRIMERA", "SEGUNDA", "TERCERA", "CUARTA", "QUINTA", "SEXTA", "SÉPTIMA", "OCTAVA", "NOVENA"];
  const decenas10_19 = ["DÉCIMA", "DECIMOPRIMERA", "DECIMOSEGUNDA", "DECIMOTERCERA", "DECIMOCUARTA", "DECIMOQUINTA", "DECIMOSEXTA", "DECIMOSÉPTIMA", "DECIMOCTAVA", "DECIMONOVENA"];
  const decenas = ["", "", "VIGÉSIMA", "TRIGÉSIMA", "CUADRAGÉSIMA", "QUINCUAGÉSIMA", "SEXAGÉSIMA", "SEPTUAGÉSIMA", "OCTOGÉSIMA", "NONAGÉSIMA"];
  if (num >= 1 && num <= 9) return unidades[num];
  if (num >= 10 && num <= 19) return decenas10_19[num - 10];
  if (num === 100) return "CENTÉSIMA";
  if (num >= 20 && num <= 99) {
    const d = Math.floor(num / 10);
    const u = num % 10;
    return u === 0 ? decenas[d] : `${decenas[d]} ${unidades[u]}`.trim();
  }
  return String(num);
}

function numeroToOrdinalAbbrServer(n: string | number): string {
  const num = typeof n === "string" ? parseInt(n.replace(/\D/g, ""), 10) : n;
  if (!num || isNaN(num) || num < 1) return "";
  return `${num}.ª`;
}

// Hidratación defensiva: si vienen vacíos, los calculamos del número.
function hydrateNotariaDerivados(nt: any): any {
  if (!nt || typeof nt !== "object") return nt;
  const out = { ...nt };
  const num = (out.numero_notaria ?? "").toString().trim();
  if (num) {
    if (!out.numero_notaria_letras || !out.numero_notaria_letras.toString().trim()) {
      out.numero_notaria_letras = numeroNotariaToLetrasServer(num);
    }
    if (!out.numero_ordinal || !out.numero_ordinal.toString().trim()) {
      out.numero_ordinal = numeroToOrdinalAbbrServer(num);
    }
  }
  return out;
}

// Pre-cómputo de strings de prosa notarial. Estos textos se embeben
// LITERALMENTE en la salida del modelo, eliminando el principal vector
// de error (formateo inconsistente de letras+número).
function buildProsaHelpers(inmueble: any, actos: any, vendedores: any[]): Record<string, string> {
  const out: Record<string, string> = {};

  // Escritura constitutiva de PH
  if (inmueble?.es_propiedad_horizontal) {
    const ph = escrituraProsa({
      numero: inmueble.escritura_ph_numero,
      fecha: inmueble.escritura_ph_fecha,
      notariaNumero: inmueble.escritura_ph_notaria_numero,
      circulo: inmueble.escritura_ph_ciudad,
    });
    if (ph) out.escritura_ph = ph;
  }

  // Antecedente / procedencia
  const titulo = (inmueble?.titulo_antecedente as Record<string, any>) || {};
  const proc = escrituraProsa({
    numero: titulo.numero_documento ?? titulo.numero_escritura,
    fecha: titulo.fecha_documento ?? titulo.fecha,
    notariaNumero: titulo.notaria_numero ?? titulo.notaria_documento,
    circulo: titulo.ciudad_documento ?? titulo.circulo,
  });
  if (proc) out.escritura_procedencia = proc;
  if (vendedores?.[0]?.nombre_completo) out.vendedor_principal = String(vendedores[0].nombre_completo);

  // Montos
  if (actos?.valor_compraventa) out.monto_compraventa = montoProsa(String(actos.valor_compraventa));
  if (actos?.valor_hipoteca) out.monto_hipoteca = montoProsa(String(actos.valor_hipoteca));
  if (actos?.pago_inicial) out.monto_pago_inicial = montoProsa(String(actos.pago_inicial));
  if (actos?.saldo_financiado) out.monto_saldo_financiado = montoProsa(String(actos.saldo_financiado));

  // Fecha de crédito (informativa)
  if (actos?.fecha_credito) {
    const f = fechaProsa(String(actos.fecha_credito));
    if (f) out.fecha_credito = f;
  }
  return out;
}
