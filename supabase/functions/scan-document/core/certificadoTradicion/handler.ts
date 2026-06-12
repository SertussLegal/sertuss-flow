import { runGemini } from "../../shared/runGemini.ts";
import type { ExtractedJson } from "../../types.ts";
import { CERTIFICADO_TRADICION_TOOL_NAME, certificadoTradicionTools } from "./tool.ts";
import { certificadoTradicionPrompt } from "./prompt.ts";

export async function handle(image: string, apiKey: string): Promise<ExtractedJson> {
  return await runGemini({
    apiKey,
    image,
    systemPrompt: certificadoTradicionPrompt,
    tools: certificadoTradicionTools,
    toolName: CERTIFICADO_TRADICION_TOOL_NAME,
  });
}
