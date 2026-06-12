// Tool schema for OCR of bank "poder bancario". Verbatim from legacy
// scan-document/index.ts (toolsByPoderBanco).

import { confField } from "../../shared/confFields.ts";

export const poderBancoTool = {
  type: "function" as const,
  function: {
    name: "extract_poder_banco",
    description: "Extrae datos del poder otorgado por una entidad bancaria. Cada campo incluye nivel de confianza.",
    parameters: {
      type: "object",
      properties: {
        entidad_bancaria: confField("Nombre de la entidad bancaria"),
        apoderado_nombre: confField("Nombre completo del apoderado del banco"),
        apoderado_cedula: confField("Número de cédula del apoderado del banco"),
        apoderado_expedida_en: confField("Lugar de expedición de la cédula del apoderado"),
        escritura_poder_num: confField("Número de la escritura pública del poder"),
        fecha_poder: confField("Fecha de otorgamiento del poder (DD-MM-AAAA)"),
        notaria_poder: confField("Nombre o número de la notaría donde se otorgó el poder"),
        notaria_poder_ciudad: confField("Ciudad de la notaría donde se otorgó el poder"),
        apoderado_email: confField("Correo electrónico del apoderado, si aparece"),
      },
      required: ["entidad_bancaria", "apoderado_nombre", "apoderado_cedula"],
      additionalProperties: false,
    },
  },
};

export const poderBancoTools = [poderBancoTool];
export const PODER_BANCO_TOOL_NAME = "extract_poder_banco";
