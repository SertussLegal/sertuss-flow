import { runGemini } from "../../shared/runGemini.ts";
import type { ExtractedJson } from "../../types.ts";
import { CEDULA_TOOL_NAME, cedulaTools } from "./tool.ts";
import { cedulaPrompt } from "./prompt.ts";

export async function handle(image: string, apiKey: string): Promise<ExtractedJson> {
  return await runGemini({
    apiKey,
    image,
    systemPrompt: cedulaPrompt,
    tools: cedulaTools,
    toolName: CEDULA_TOOL_NAME,
  });
}
