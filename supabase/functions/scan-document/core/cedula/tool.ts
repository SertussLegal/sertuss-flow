// Tool schema for OCR of Colombian "cédula de ciudadanía". Verbatim from
// legacy scan-document/index.ts (toolsByCedula).

export const cedulaTool = {
  type: "function" as const,
  function: {
    name: "extract_cedula",
    description: "Extrae los datos de una cédula de ciudadanía colombiana a partir de la imagen. Cada campo incluye un nivel de confianza.",
    parameters: {
      type: "object",
      properties: {
        nombre_completo: {
          type: "object",
          properties: {
            valor: { type: "string", description: "Nombre completo tal como aparece en la cédula" },
            confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza de la extracción" },
          },
          required: ["valor", "confianza"],
          additionalProperties: false,
        },
        numero_cedula: {
          type: "object",
          properties: {
            valor: { type: "string", description: "Número de cédula sin puntos ni separadores" },
            confianza: { type: "string", enum: ["alta", "media", "baja"] },
          },
          required: ["valor", "confianza"],
          additionalProperties: false,
        },
        municipio_expedicion: {
          type: "object",
          properties: {
            valor: { type: "string", description: "Municipio de expedición de la cédula" },
            confianza: { type: "string", enum: ["alta", "media", "baja"] },
          },
          required: ["valor", "confianza"],
          additionalProperties: false,
        },
      },
      required: ["nombre_completo", "numero_cedula", "municipio_expedicion"],
      additionalProperties: false,
    },
  },
};

export const cedulaTools = [cedulaTool];
export const CEDULA_TOOL_NAME = "extract_cedula";
