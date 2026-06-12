import { runGemini } from "../../shared/runGemini.ts";
import type { ExtractedJson } from "../../types.ts";
import { ESCRITURA_ANTECEDENTE_TOOL_NAME, escrituraAntecedenteTools } from "./tool.ts";
import { escrituraAntecedentePrompt } from "./prompt.ts";

export async function handle(image: string, apiKey: string): Promise<ExtractedJson> {
  return await runGemini({
    apiKey,
    image,
    systemPrompt: escrituraAntecedentePrompt,
    tools: escrituraAntecedenteTools,
    toolName: ESCRITURA_ANTECEDENTE_TOOL_NAME,
  });
}
