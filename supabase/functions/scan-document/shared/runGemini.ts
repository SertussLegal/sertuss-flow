// Common helper to invoke the Lovable AI Gateway (Gemini 2.5 Flash) with
// a tool-call enforced schema. Centralizes the same call shape that lived
// inline in the legacy `scan-document/index.ts`.
//
// v2: acepta `images: string[]` para procesar múltiples páginas en UN SOLO
// turno multimodal (anti rate-limit). Mantiene la firma legacy `image: string`
// para back-compat con handlers existentes (cedula, predial, cartaCredito, etc.).

import { fetchAiGateway, parseToolCallArguments } from "../../_shared/aiFetch.ts";
import { STRICT_OUTPUT_RULES, sanitizeAiJson } from "../../_shared/aiOutputRules.ts";
import type { ExtractedJson } from "../types.ts";

export interface RunGeminiOpts {
  apiKey: string;
  /** Single image (legacy). Use `images` para batch. */
  image?: string;
  /** Batch de imágenes en un solo turno multimodal (recomendado para >1 página). */
  images?: string[];
  systemPrompt: string;
  tools: any[];
  toolName: string;
  /** Override del modelo. Default: google/gemini-2.5-flash. */
  model?: string;
  /** Override del texto de instrucción al usuario. */
  userText?: string;
}

function toDataUri(img: string): string {
  return img.startsWith("data:") || img.startsWith("http")
    ? img
    : `data:image/jpeg;base64,${img}`;
}

export async function runGemini(opts: RunGeminiOpts): Promise<ExtractedJson> {
  const { apiKey, image, images, systemPrompt, tools, toolName, model, userText } = opts;

  const imageList: string[] = images && images.length > 0
    ? images
    : (image ? [image] : []);
  if (imageList.length === 0) {
    throw new Error("runGemini: se requiere `image` o `images` con al menos un elemento.");
  }

  const instruction = userText
    ?? (imageList.length === 1
      ? "Analiza esta imagen y extrae los datos solicitados. Asigna un nivel de confianza a cada campo."
      : `Analiza las ${imageList.length} páginas adjuntas como un único documento y extrae los datos solicitados. Asigna un nivel de confianza a cada campo.`);

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: instruction },
    ...imageList.map((img) => ({
      type: "image_url" as const,
      image_url: { url: toDataUri(img) },
    })),
  ];

  const aiBody = {
    model: model ?? "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt + STRICT_OUTPUT_RULES },
      { role: "user", content: userContent },
    ],
    tools,
    tool_choice: { type: "function", function: { name: toolName } },
  };

  const response = await fetchAiGateway({
    apiKey,
    body: aiBody,
    tag: "scan-document",
  });

  const extractedData = await parseToolCallArguments<ExtractedJson>(response, "scan-document");
  return sanitizeAiJson(extractedData);
}
