// Shared types for the scan-document edge function module.
// Keep in sync with `core/*/handler.ts` HANDLERS map in index.ts.

export type DocType =
  | "cedula"
  | "certificado_tradicion"
  | "predial"
  | "escritura_antecedente"
  | "poder_banco"
  | "carta_credito";

export type ExtractedJson = Record<string, unknown>;

export type Handler = (
  image: string,
  apiKey: string,
) => Promise<ExtractedJson>;
