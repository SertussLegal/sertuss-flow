// Shared schema helpers for confidence-wrapped fields used by every
// scan-document tool definition. Verbatim from the original index.ts.

export const confField = (desc: string) => ({
  type: "object",
  properties: {
    valor: { type: "string", description: desc },
    confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza" },
  },
  required: ["valor", "confianza"],
  additionalProperties: false,
});

export const confBoolField = (desc: string) => ({
  type: "object",
  properties: {
    valor: { type: "boolean", description: desc },
    confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza" },
  },
  required: ["valor", "confianza"],
  additionalProperties: false,
});
