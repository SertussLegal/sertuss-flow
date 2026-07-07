// ============================================================================
// poderBancoExtractor — Punto de entrada isomórfico.
//
// `buildPoderBancoRequest(imageUrls)` devuelve un cuerpo listo para POSTear
// al AI Gateway (compatible OpenAI Chat Completions). Lo consumen:
//   - scan-document/core/poderBanco/handler.ts (vía runGemini que arma esto)
//   - procesar-cancelacion/index.ts (extractor v6 dedicado, cuando el flag
//     POWER_V6_EXTRACTOR_ENABLED está activo).
//
// 🛡️ PUREZA: solo TS. Ninguna dependencia de fetch, Deno, ni cliente.
// ============================================================================

import { poderBancoTools, PODER_BANCO_TOOL_NAME } from "./tool.ts";
import { poderBancoPrompt } from "./prompt.ts";

export { poderBancoTools, PODER_BANCO_TOOL_NAME, poderBancoPrompt };
export { poderBancoTool } from "./tool.ts";

export interface PoderBancoDeepPayload {
  entidad_bancaria?: { valor?: string | null; confianza?: string } | null;
  apoderado_nombre?: { valor?: string | null; confianza?: string } | null;
  apoderado_cedula?: { valor?: string | null; confianza?: string } | null;
  escritura_poder_num?: { valor?: string | null; confianza?: string } | null;
  fecha_poder?: { valor?: string | null; confianza?: string } | null;
  notaria_poder?: { valor?: string | null; confianza?: string } | null;
  notaria_poder_ciudad?: { valor?: string | null; confianza?: string } | null;
  apoderado_email?: { valor?: string | null; confianza?: string } | null;
  has_apoderado_banco_v3?: "true" | "false" | "null";
  motivos_incompletitud?: string[];
  poderdante?: {
    entidad_nombre?: string | null;
    entidad_nit?: string | null;
    entidad_constitucion_escritura?: string | null;
    representante_legal_nombre?: string | null;
    representante_legal_cedula?: string | null;
    representante_legal_cargo?: string | null;
    representante_legal_cedula_expedida_en?: string | null;
  } | null;
  apoderado?: {
    tipo?: "natural" | "juridica" | null;
    nombre?: string | null;
    cedula?: string | null;
    sociedad_razon_social?: string | null;
    sociedad_nit?: string | null;
    sociedad_constitucion?: Record<string, string | null> | null;
    sociedad_reformas?: string | null;
    representantes?: Array<{
      nombre?: string;
      cedula?: string;
      cargo?: string;
      email?: string;
      es_firmante?: boolean;
    }>;
  } | null;
  instrumento_poder?: {
    escritura_num?: string | null;
    fecha?: string | null;
    fecha_texto?: string | null;
    notaria_numero?: string | null;
    notaria_ciudad?: string | null;
    notario_titular_nombre?: string | null;
    notario_encargado_nombre?: string | null;
    resolucion_encargo?: string | null;
  } | null;
  facultades?: Record<string, boolean | string> | null;
  vigencia?: {
    tipo?: string;
    fecha_limite?: string | null;
    descripcion?: string | null;
  } | null;
  sustitucion_permitida?: boolean;
  anexos?: Array<{ tipo?: string; descripcion?: string; fecha?: string }>;
}

export interface BuildPoderRequestOpts {
  imageUrls: string[];
  /** Model override. Default: google/gemini-2.5-flash. */
  model?: string;
  /** Texto de instrucción al usuario. */
  userText?: string;
}

export interface AiGatewayRequestBody {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string | Array<Record<string, unknown>>;
  }>;
  tools: unknown[];
  tool_choice: { type: "function"; function: { name: string } };
}

/**
 * Construye el cuerpo canónico para invocar Gemini con el schema v6 del
 * Poder Banco. `imageUrls` pueden ser data-URIs base64 o URLs firmadas.
 */
export function buildPoderBancoRequest(opts: BuildPoderRequestOpts): AiGatewayRequestBody {
  const { imageUrls, model, userText } = opts;
  if (!imageUrls || imageUrls.length === 0) {
    throw new Error("buildPoderBancoRequest: imageUrls vacío");
  }
  const instruction = userText ??
    `Analiza las ${imageUrls.length} páginas adjuntas como un único Poder General bancario. ` +
      `Aplica la Regla K y devuelve el schema profundo + los campos planos legacy. ` +
      `Llama SIEMPRE a la herramienta ${PODER_BANCO_TOOL_NAME}.`;

  return {
    model: model ?? "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: poderBancoPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      },
    ],
    tools: poderBancoTools,
    tool_choice: { type: "function", function: { name: PODER_BANCO_TOOL_NAME } },
  };
}
