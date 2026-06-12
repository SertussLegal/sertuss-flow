// Tool schema for OCR of Colombian "predial / boletín catastral". Verbatim
// from legacy scan-document/index.ts (toolsByPredial).

import { confField } from "../../shared/confFields.ts";

export const predialTool = {
  type: "function" as const,
  function: {
    name: "extract_predial",
    description: "Extrae datos de un documento predial o boletín catastral colombiano. Cada campo incluye nivel de confianza.",
    parameters: {
      type: "object",
      properties: {
        chip_nupre: confField("CHIP o NUPRE del inmueble (código alfanumérico que comienza con AAA, exclusivo de Bogotá). NO es la cédula catastral."),
        cedula_catastral: confField("Cédula catastral numérica del predio (~20-30 dígitos). NO es el CHIP/NUPRE. Ejemplo: 001101065800709005"),
        identificador_predial: confField("Identificador predial si no se puede clasificar como CHIP ni cédula catastral"),
        avaluo_catastral: confField("Valor del avalúo catastral en pesos colombianos"),
        area: confField("Área del predio en m²"),
        direccion: confField("Dirección del predio"),
        numero_recibo: confField("Número del recibo de pago del impuesto predial"),
        anio_gravable: confField("Año gravable del impuesto predial"),
        valor_pagado: confField("Valor total pagado del impuesto predial en pesos colombianos"),
        estrato: confField("Estrato socioeconómico del predio (1-6)"),
      },
      required: ["avaluo_catastral"],
      additionalProperties: false,
    },
  },
};

export const predialTools = [predialTool];
export const PREDIAL_TOOL_NAME = "extract_predial";
