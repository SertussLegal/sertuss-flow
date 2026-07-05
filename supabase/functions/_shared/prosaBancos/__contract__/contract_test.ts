// ============================================================================
// Fase 3 — Auditoría del schema OCR contra el contrato Davivienda.
// Recorre cada `ocrSchemaPaths[*].path` del contrato y verifica que exista
// como propiedad tipada en `poderBancoTool.function.parameters`.
// Falla si alguien elimina un campo required/conditional/recommended sin
// actualizar el contrato.
// ============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import contract from "./referencia_davivienda.contract.json" with { type: "json" };
import { poderBancoTool } from "../../../../scan-document/core/poderBanco/tool.ts";

type Schema = {
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
};

function walk(schema: Schema, path: string): Schema | null {
  const segments = path.split(".");
  let node: Schema | undefined = schema;
  for (const seg of segments) {
    if (!node) return null;
    if (node.type === "array" && node.items) node = node.items;
    if (!node.properties) return null;
    node = node.properties[seg];
  }
  return node ?? null;
}

Deno.test("contract: schema OCR contiene todos los paths declarados", () => {
  const root = poderBancoTool.function.parameters as Schema;
  const missing: string[] = [];
  for (const entry of contract.ocrSchemaPaths) {
    const node = walk(root, entry.path);
    if (!node) missing.push(entry.path);
  }
  assertEquals(missing, [], `Faltan en tool.ts: ${missing.join(", ")}`);
});

Deno.test("contract: enum de has_apoderado_banco_v3 preserva el ternario", () => {
  const node = walk(poderBancoTool.function.parameters as Schema, "has_apoderado_banco_v3") as
    | (Schema & { enum?: string[] })
    | null;
  assert(node, "has_apoderado_banco_v3 no está en el schema");
  assertEquals(node!.enum, ["true", "false", "null"]);
});

Deno.test("contract: apoderado.representantes es array", () => {
  const root = poderBancoTool.function.parameters as Schema;
  const node = root.properties?.apoderado?.properties?.representantes;
  assertEquals(node?.type, "array");
});

Deno.test("contract: NIT del banco es constante inmutable", () => {
  assertEquals(contract.nit, "860.034.313-7");
  assertEquals(contract.bank, "BANCO DAVIVIENDA S.A.");
});
