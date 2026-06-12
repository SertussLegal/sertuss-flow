// Tool schema for OCR of a "carta de crédito" (mortgage approval letter).
// Verbatim from legacy scan-document/index.ts (toolsByCartaCredito).

import { confField } from "../../shared/confFields.ts";

export const cartaCreditoTool = {
  type: "function" as const,
  function: {
    name: "extract_carta_credito",
    description: "Extrae el valor del crédito hipotecario de una carta de aprobación. Cada campo incluye nivel de confianza.",
    parameters: {
      type: "object",
      properties: {
        valor_credito: confField("Valor aprobado del crédito hipotecario en pesos colombianos"),
        entidad_bancaria: confField("Nombre de la entidad bancaria que otorga el crédito"),
      },
      required: ["valor_credito"],
      additionalProperties: false,
    },
  },
};

export const cartaCreditoTools = [cartaCreditoTool];
export const CARTA_CREDITO_TOOL_NAME = "extract_carta_credito";
