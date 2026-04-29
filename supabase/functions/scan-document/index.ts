import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAiGateway, aiGatewayErrorResponse, parseToolCallArguments } from "../_shared/aiFetch.ts";

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
      description: "Extrae los datos principales de un certificado de tradición y libertad colombiano, estructurados en cuatro nodos: documento, inmueble, personas y actos. Cada campo tiene un nivel de confianza.",
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
              nombre_conjunto_edificio: confField("Nombre del conjunto, edificio o agrupación de propiedad horizontal (ej: ALTAVISTA EL MIRADOR, TORRES DEL PARQUE)"),
              escritura_ph_numero: confField("Número de la escritura pública de constitución del régimen PH"),
              escritura_ph_fecha: confField("Fecha de la escritura de constitución PH (DD-MM-AAAA)"),
              escritura_ph_notaria: confField("Nombre o número de la notaría donde se otorgó la escritura de PH"),
              escritura_ph_ciudad: confField("Ciudad/Círculo de la notaría de la escritura PH"),
              matricula_matriz: confField("Número de matrícula inmobiliaria matriz del conjunto o edificio"),
              coeficiente_copropiedad: confField("Coeficiente de copropiedad del inmueble (porcentaje o fracción, ej: 2.345%)"),
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
          actos: {
            type: "object",
            description: "Actos jurídicos registrados en el certificado (sección ACTOS: CUANTÍA)",
            properties: {
              tipo_acto_principal: confField("Acto principal: Compraventa, Donación, Permuta, etc."),
              valor_compraventa: confField("Valor del acto principal en pesos colombianos (solo número, sin $ ni puntos)"),
              es_hipoteca: confBoolField("true si incluye un acto de hipoteca (abierta o cerrada)"),
              valor_hipoteca: confField("Valor de la hipoteca en pesos (solo número). Poner '0' si es sin límite de cuantía"),
              entidad_bancaria: confField("Nombre de la entidad bancaria acreedora (ej: BANCO DE BOGOTA S.A.)"),
              entidad_nit: confField("NIT de la entidad bancaria con dígito de verificación (ej: 860.002.964-4)"),
              afectacion_vivienda_familiar: confBoolField("true si hay acto de afectación a vivienda familiar registrado"),
            },
            required: ["tipo_acto_principal"],
            additionalProperties: false,
          },
          titulo_antecedente: {
            type: "object",
            description: "Título antecedente: documento mediante el cual el propietario actual adquirió el bien",
            properties: {
              tipo_documento: confField("Tipo de documento: Escritura Pública, Sentencia Judicial, Resolución, etc."),
              numero_documento: confField("Número del documento (ej: número de escritura pública)"),
              fecha_documento: confField("Fecha del título antecedente (DD-MM-AAAA)"),
              notaria_documento: confField("Notaría o juzgado donde se otorgó el título antecedente"),
              ciudad_documento: confField("Ciudad/Círculo de la notaría del título antecedente"),
              adquirido_de: confField("Nombre de quien transfirió el bien al propietario actual"),
            },
            required: ["tipo_documento"],
            additionalProperties: false,
          },
        },
        required: ["documento", "inmueble", "personas", "actos", "titulo_antecedente"],
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
      description: "Extrae datos de una escritura pública antecedente colombiana. Incluye linderos y datos del acto. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          linderos_especiales: confField("Linderos especiales (particulares) del inmueble, transcribir textualmente cada palabra"),
          linderos_generales: confField("Linderos generales del edificio o conjunto (aplica si es propiedad horizontal), transcribir textualmente"),
          numero_escritura: confField("Número de la escritura pública"),
          fecha_escritura: confField("Fecha de la escritura (DD-MM-AAAA)"),
          notaria: confField("Nombre o número de la notaría donde se otorgó"),
          ciudad_notaria: confField("Ciudad de la notaría"),
          tipo_acto: confField("Tipo de acto: Compraventa, Donación, Permuta, etc."),
          comparecientes: {
            type: "array",
            description: "Personas que comparecen en la escritura, con datos de la sección de COMPARECENCIA",
            items: {
              type: "object",
              properties: {
                nombre: { type: "string", description: "Nombre completo" },
                cedula: { type: "string", description: "Número de cédula o NIT" },
                rol: { type: "string", description: "Rol: vendedor, comprador, otorgante, apoderado, etc." },
                estado_civil: { type: "string", description: "VALOR ATÓMICO. Solo el estado civil puro (ej: 'soltero sin unión marital de hecho', 'casada con sociedad conyugal vigente', 'unión marital de hecho'). PROHIBIDO incluir frases como 'mayor de edad', 'de nacionalidad colombiana', 'identificado con', 'domiciliado'. Si no encuentras el estado civil específico, devuelve cadena vacía." },
                direccion: { type: "string", description: "VALOR ATÓMICO. Dirección postal específica con números (ej: 'Calle 10 # 20-30', 'Carrera 7 No. 45-12 Apto 301'). PROHIBIDO devolver frases genéricas como 'esta ciudad', 'domiciliado en esta ciudad', 'en la ciudad'. Si no hay dirección postal específica con números, devuelve cadena vacía." },
                municipio_domicilio: { type: "string", description: "VALOR ATÓMICO. Solo el nombre del municipio (ej: 'Bogotá', 'Medellín', 'Cali'). PROHIBIDO devolver 'esta ciudad', 'el municipio', 'esta localidad' o frases genéricas. Si no encuentras un municipio nombrado, devuelve cadena vacía." },
              },
              required: ["nombre"],
              additionalProperties: false,
            },
          },
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

  certificado_tradicion: `Eres un sistema OCR especializado en certificados de tradición y libertad colombianos. Analiza el documento y extrae los datos estructurados en CINCO nodos:

1. DOCUMENTO: fecha del documento o escritura de origen, notaría de origen, número de escritura pública.

2. INMUEBLE: matrícula inmobiliaria, ORIP, dirección, municipio, departamento, linderos completos (transcribir TEXTUALMENTE cada palabra), NUPRE/CHIP (código que suele comenzar con AAA), áreas (diferencia entre construida CONST y privada PRIV), tipo de predio, y si tiene propiedad horizontal con su escritura de constitución y reformas.

INFERENCIA JURÍDICA PH: Si detectas las palabras "Régimen de Propiedad Horizontal", "P.H.", "PH" o "PROPIEDAD HORIZONTAL" en cualquier anotación:
- Marca es_propiedad_horizontal: true
- Busca OBLIGATORIAMENTE: nombre del conjunto/edificio/agrupación, coeficiente de copropiedad, matrícula inmobiliaria matriz, escritura de constitución PH con su número, fecha, notaría y ciudad
- El nombre del conjunto suele aparecer como "CONJUNTO CERRADO [NOMBRE]" o "EDIFICIO [NOMBRE]" o "AGRUPACIÓN [NOMBRE]"

3. PERSONAS: TODAS las personas y entidades que aparecen en el certificado (propietarios actuales, anteriores, acreedores hipotecarios, constructoras, bancos, etc.). Para cada una extrae: nombre completo o razón social, número de identificación (cédula o NIT), tipo de identificación (CC, NIT, CE), y lugar de expedición.

ROLES SEMÁNTICOS: Asigna roles basados en la estructura del acto:
- Si una persona aparece después de "DE:" en una compraventa → es el vendedor (quien transfirió)
- Si aparece después de "A FAVOR DE:" → es el comprador/propietario actual
- "Sujeto Pasivo" en predial = propietario actual

4. ACTOS: Busca la sección "ACTOS: CUANTÍA" o "ANOTACIONES". Identifica:
   - El acto principal (Compraventa, Donación, Permuta, Cesión, etc.) y su cuantía en pesos
   - Si hay hipoteca (abierta o cerrada), su valor y la entidad bancaria acreedora con su NIT
   - Si hay afectación a vivienda familiar (SI/NO)
   - El acto más reciente y de mayor relevancia es el "principal"

5. TÍTULO ANTECEDENTE: Identifica la anotación que dio origen a la propiedad ACTUAL del vendedor. Busca el acto de compraventa, donación, sentencia o resolución más reciente que transfirió la propiedad al propietario actual. Extrae:
   - Tipo de documento (Escritura Pública, Sentencia Judicial, Resolución)
   - Número del documento
   - Fecha
   - Notaría o juzgado donde se otorgó
   - Ciudad
   - Nombre de quien transfirió el bien (el vendedor anterior)

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

Además, extrae los COMPARECIENTES de la sección de COMPARECENCIA de la escritura. Para cada compareciente, busca:
- Nombre completo
- Número de cédula o NIT
- Rol (vendedor, comprador, otorgante, apoderado)
- Estado civil declarado (busca frases como "de estado civil soltero", "casado", "en unión marital de hecho", "divorciado", "viudo")
- Dirección de residencia (busca "domiciliado en", "residente en", "con domicilio en")
- Municipio de domicilio (busca "vecino de", "domiciliado en [ciudad]")

La escritura es la FUENTE DE VERDAD para estado civil, dirección y municipio de domicilio. Estos datos NO aparecen en la cédula física colombiana.

REGLA CRÍTICA — VALORES ATÓMICOS (OBLIGATORIO):
- estado_civil: extrae SOLO el estado civil puro y sus calificadores directos (ej: "soltero sin unión marital de hecho", "casada con sociedad conyugal vigente"). NUNCA incluyas "mayor de edad", "de nacionalidad colombiana", "identificado(a) con", "domiciliado(a) en", ni ningún otro texto formulario.
- direccion: extrae SOLO una dirección postal real con números (ej: "Calle 10 # 20-30 Apto 401"). Si solo aparece "domiciliado en esta ciudad" o frases similares sin dirección postal específica, devuelve cadena vacía "".
- municipio_domicilio: extrae SOLO el nombre propio del municipio (ej: "Bogotá"). Si solo dice "esta ciudad", "el municipio" o referencias genéricas, devuelve cadena vacía "".
- Ante la duda, prefiere DEVOLVER VACÍO antes que incluir boilerplate notarial. La app marcará el campo como faltante y pedirá al usuario completarlo.

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

    let response: Response;
    try {
      response = await fetchAiGateway({
        apiKey: LOVABLE_API_KEY,
        body: JSON.parse(aiBody),
        tag: "scan-document",
      });
    } catch (err) {
      const r = aiGatewayErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }

    let extractedData: Record<string, unknown>;
    try {
      extractedData = await parseToolCallArguments<Record<string, unknown>>(response, "scan-document");
    } catch (err) {
      const r = aiGatewayErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }

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
