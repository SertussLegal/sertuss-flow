import { runGemini } from "../../shared/runGemini.ts";
import type { ExtractedJson } from "../../types.ts";
import { PREDIAL_TOOL_NAME, predialTools } from "./tool.ts";
import { predialPrompt } from "./prompt.ts";

export async function handle(image: string, apiKey: string): Promise<ExtractedJson> {
  return await runGemini({
    apiKey,
    image,
    systemPrompt: predialPrompt,
    tools: predialTools,
    toolName: PREDIAL_TOOL_NAME,
  });
}
