// Common helper to invoke the Lovable AI Gateway (Gemini 2.5 Flash) with
// a tool-call enforced schema. Centralizes the same call shape that lived
// inline in the legacy `scan-document/index.ts`.

import { fetchAiGateway, parseToolCallArguments } from "../../_shared/aiFetch.ts";
import { STRICT_OUTPUT_RULES, sanitizeAiJson } from "../../_shared/aiOutputRules.ts";
import type { ExtractedJson } from "../types.ts";

export interface RunGeminiOpts {
  apiKey: string;
  image: string;
  systemPrompt: string;
  tools: any[];
  toolName: string;
}

export async function runGemini(opts: RunGeminiOpts): Promise<ExtractedJson> {
  const { apiKey, image, systemPrompt, tools, toolName } = opts;

  const imageDataUri = image.startsWith("data:")
    ? image
    : `data:image/jpeg;base64,${image}`;

  const aiBody = JSON.stringify({
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt + STRICT_OUTPUT_RULES },
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

  const response = await fetchAiGateway({
    apiKey,
    body: JSON.parse(aiBody),
    tag: "scan-document",
  });

  const extractedData = await parseToolCallArguments<ExtractedJson>(response, "scan-document");
  return sanitizeAiJson(extractedData);
}
