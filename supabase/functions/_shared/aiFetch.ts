// Shared helper to call the Lovable AI Gateway with retries, typed errors,
// and a safe tool-call argument parser. Used by scan-document,
// process-expediente, and generate-document to eliminate TS18047
// ("Object is possibly 'null'") and unify 402 / 429 / 5xx handling.

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export class AiGatewayError extends Error {
  status: number;
  rawBody: string;
  tag?: string;

  constructor(status: number, rawBody: string, message?: string, tag?: string) {
    super(message ?? `AI gateway error ${status}`);
    this.name = "AiGatewayError";
    this.status = status;
    this.rawBody = rawBody;
    this.tag = tag;
  }
}

export interface FetchAiGatewayOptions {
  apiKey: string;
  body: unknown;
  /** Number of additional attempts after the first one. Defaults to 2 (3 total). */
  maxRetries?: number;
  /** Linear backoff base in ms. Wait = base * (attempt + 1). Default 2000ms. */
  backoffMs?: number;
  /** Tag for log prefixing, e.g. "scan-document". */
  tag?: string;
}

/**
 * Calls the Lovable AI Gateway. Returns a non-null Response (status 2xx) or
 * throws AiGatewayError preserving the original status code.
 *
 * Retries on 429, 502, 503 and on network errors with linear backoff.
 */
export async function fetchAiGateway(
  opts: FetchAiGatewayOptions,
): Promise<Response> {
  const {
    apiKey,
    body,
    maxRetries = 2,
    backoffMs = 2000,
    tag = "ai-gateway",
  } = opts;

  const totalAttempts = maxRetries + 1;
  const serializedBody = typeof body === "string" ? body : JSON.stringify(body);

  let lastStatus = 0;
  let lastBody = "";
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const response = await fetch(AI_GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: serializedBody,
      });

      if (response.ok) return response;

      // Read body so we can log + re-use the connection cleanly.
      lastStatus = response.status;
      lastBody = await response.text().catch(() => "");

      const retryable = response.status === 429 || response.status === 502 || response.status === 503;
      console.error(
        `[${tag}] AI gateway non-OK status=${response.status} attempt=${attempt + 1}/${totalAttempts} body=${lastBody.slice(0, 300)}`,
      );

      if (!retryable || attempt === totalAttempts - 1) {
        throw new AiGatewayError(response.status, lastBody, undefined, tag);
      }

      await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
    } catch (err) {
      if (err instanceof AiGatewayError) throw err;

      lastNetworkError = err;
      console.error(
        `[${tag}] AI gateway network error attempt=${attempt + 1}/${totalAttempts}:`,
        err instanceof Error ? err.message : String(err),
      );

      if (attempt === totalAttempts - 1) {
        throw new AiGatewayError(
          0,
          err instanceof Error ? err.message : String(err),
          "AI gateway network error",
          tag,
        );
      }
      await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
    }
  }

  // Defensive — loop above always returns or throws.
  throw new AiGatewayError(
    lastStatus || 500,
    lastBody || (lastNetworkError ? String(lastNetworkError) : "unknown"),
    "AI gateway exhausted retries",
    tag,
  );
}

/**
 * Maps an AiGatewayError to a Response with CORS headers, preserving 402 and
 * 429 status codes (so the client can react to credits / rate-limit). Returns
 * null if the error is not an AiGatewayError (caller should fall through to
 * its own catch).
 */
export function aiGatewayErrorResponse(
  err: unknown,
  corsHeaders: Record<string, string>,
): Response | null {
  if (!(err instanceof AiGatewayError)) return null;

  let status = 500;
  let message = "Error al procesar con IA";

  if (err.status === 429) {
    status = 429;
    message = "Límite de solicitudes excedido. Intenta de nuevo en unos minutos.";
  } else if (err.status === 402) {
    status = 402;
    message = "Créditos de IA agotados. Contacta al administrador.";
  } else if (err.status === 502) {
    status = 502;
    message = "La IA no devolvió datos estructurados válidos.";
  }

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface ToolCallShape {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
}

/**
 * Extracts choices[0].message.tool_calls[0].function.arguments from a Lovable
 * AI Gateway response and parses it as JSON. Throws AiGatewayError(502) if
 * the response shape is invalid or arguments are not valid JSON. Returns the
 * parsed object as T (non-null by type).
 */
export async function parseToolCallArguments<T>(
  response: Response,
  tag = "ai-gateway",
): Promise<T> {
  let result: ToolCallShape;
  try {
    result = (await response.json()) as ToolCallShape;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${tag}] Failed to parse AI gateway JSON:`, msg);
    throw new AiGatewayError(502, msg, "AI gateway returned non-JSON body", tag);
  }

  const args = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;

  if (typeof args !== "string" || args.length === 0) {
    const raw = JSON.stringify(result).slice(0, 500);
    console.error(`[${tag}] No tool_call arguments in AI response: ${raw}`);
    throw new AiGatewayError(502, raw, "AI did not return tool_call arguments", tag);
  }

  try {
    return JSON.parse(args) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${tag}] Failed to parse tool_call arguments JSON:`, msg, "raw:", args.slice(0, 500));
    throw new AiGatewayError(502, args, "AI returned invalid JSON in tool_call arguments", tag);
  }
}
