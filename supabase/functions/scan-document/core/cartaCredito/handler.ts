import { runGemini } from "../../shared/runGemini.ts";
import type { ExtractedJson } from "../../types.ts";
import { CARTA_CREDITO_TOOL_NAME, cartaCreditoTools } from "./tool.ts";
import { cartaCreditoPrompt } from "./prompt.ts";

export async function handle(image: string, apiKey: string): Promise<ExtractedJson> {
  return await runGemini({
    apiKey,
    image,
    systemPrompt: cartaCreditoPrompt,
    tools: cartaCreditoTools,
    toolName: CARTA_CREDITO_TOOL_NAME,
  });
}
