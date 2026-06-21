import { runGemini } from "../../shared/runGemini.ts";
import type { ExtractedJson } from "../../types.ts";
import { PODER_BANCO_TOOL_NAME, poderBancoTools } from "./tool.ts";
import { poderBancoPrompt } from "./prompt.ts";

/**
 * Procesa un poder bancario.
 *
 * - `imageOrImages: string` → modo legacy (1 página, llamada simple).
 * - `imageOrImages: string[]` → batch multimodal en UN SOLO turno
 *   (recomendado para poderes multipágina; respeta el RPM del gateway).
 */
export async function handle(
  imageOrImages: string | string[],
  apiKey: string,
): Promise<ExtractedJson> {
  const images = Array.isArray(imageOrImages) ? imageOrImages : undefined;
  const image = Array.isArray(imageOrImages) ? undefined : imageOrImages;

  return await runGemini({
    apiKey,
    image,
    images,
    systemPrompt: poderBancoPrompt,
    tools: poderBancoTools,
    toolName: PODER_BANCO_TOOL_NAME,
  });
}
