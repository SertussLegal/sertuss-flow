import { runGemini } from "../../shared/runGemini.ts";
import type { ExtractedJson } from "../../types.ts";
import { PODER_BANCO_TOOL_NAME, poderBancoTools } from "./tool.ts";
import { poderBancoPrompt } from "./prompt.ts";

export async function handle(image: string, apiKey: string): Promise<ExtractedJson> {
  return await runGemini({
    apiKey,
    image,
    systemPrompt: poderBancoPrompt,
    tools: poderBancoTools,
    toolName: PODER_BANCO_TOOL_NAME,
  });
}
