// ============================================================================
// Parity test: garantiza que el re-export cliente (`@/lib/apoderadoClassifier`)
// y el shim edge (`supabase/functions/_shared/apoderadoClassifier.ts`) resuelven
// a la MISMA función que la fuente única (`@/shared/apoderadoClassifier`) y
// producen ClassifierResult byte-idéntico ante inputs representativos.
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  classifyApoderado as classifyFromShared,
  type ApoderadoPayload,
} from "@/shared/apoderadoClassifier";
import { classifyApoderado as classifyFromClient } from "@/lib/apoderadoClassifier";
// Importa por path relativo del shim edge (no usa @ alias porque es fuera de src/).
import { classifyApoderado as classifyFromEdge } from "../../supabase/functions/_shared/apoderadoClassifier";

const CASES: Array<{ name: string; input: ApoderadoPayload | null }> = [
  {
    name: "natural limpio",
    input: {
      tipo: "natural",
      nombre: "ANA MARIA MONTOYA",
      escritura_poder_num: "7364",
      escritura_poder_fecha: "2023-05-26",
      escritura_poder_notaria_num: "29",
    },
  },
  {
    name: "natural contaminada corporativo",
    input: {
      tipo: "natural",
      nombre: "ANA MARIA MONTOYA",
      cargo: "Representante Legal de CONECTIVA S.A.S.",
      escritura_poder_num: "7364",
      escritura_poder_fecha: "2023-05-26",
      escritura_poder_notaria_num: "29",
    },
  },
  {
    name: "juridica incompleta (sin NIT)",
    input: {
      tipo: "juridica",
      sociedad_razon_social: "CONECTIVA S.A.S.",
      sociedad_nit: "",
      sociedad_constitucion: { fecha: "2013-10-18" },
    },
  },
  {
    name: "natural sin escritura",
    input: { tipo: "natural", nombre: "PEPE" },
  },
  {
    name: "confianza baja",
    input: {
      tipo: "natural",
      nombre: "PEPE",
      escritura_poder_num: "1",
      escritura_poder_fecha: "2020-01-01",
      escritura_poder_notaria_num: "1",
      _confianza_tipo: "baja",
    },
  },
  {
    name: "override manual juridica",
    input: { tipo: "natural", cargo: "Representante Legal", tipo_override: "juridica" },
  },
  { name: "null payload", input: null },
];

describe("apoderadoClassifier parity: cliente ↔ edge ↔ shared", () => {
  it("las tres importaciones resuelven a la misma función", () => {
    expect(classifyFromClient).toBe(classifyFromShared);
    expect(classifyFromEdge).toBe(classifyFromShared);
  });

  for (const c of CASES) {
    it(`caso "${c.name}" produce ClassifierResult idéntico`, () => {
      const rShared = classifyFromShared(c.input);
      const rClient = classifyFromClient(c.input);
      const rEdge = classifyFromEdge(c.input);
      expect(rClient).toEqual(rShared);
      expect(rEdge).toEqual(rShared);
    });
  }
});
