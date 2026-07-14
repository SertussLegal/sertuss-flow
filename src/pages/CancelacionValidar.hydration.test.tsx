// A1 — Regresión: la hidratación de `poder_banco` NO debe perder el bloque
// profundo v6 (apoderado.sociedad_*, representantes, poderdante,
// instrumento_poder, facultades, motivos_incompletitud) entre `data_ia` y
// `data_final`. Caso ancla: cancelación c8924aa2-a0ea-4e08-a857-b087db1c2dc4
// (matrícula 50C-1572091, CONECTIVA GLOBAL S.A.S. como apoderada jurídica
// de Davivienda) — antes del fix, la hidratación reconstruía `poder_banco`
// enumerando 9 claves planas a mano y descartaba silenciosamente todo lo
// profundo.

import { describe, it, expect } from "vitest";
import { hydratePoderBanco } from "./CancelacionValidar";

describe("A1 — hydratePoderBanco preserva bloque profundo v6", () => {
  it("caso ancla c8924aa2: apoderado jurídico con cadena de representación", () => {
    const ia_pb = {
      apoderado_nombre: "LINA CAMPOS",
      apoderado_cedula: "1234567",
      apoderado_escritura: "16390",
      apoderado_fecha: "2023-10-15",
      apoderado_notaria_poder: "NOTARÍA 29 BOGOTÁ",
      apoderado_genero: "F" as const,
      // Bloque profundo v6.
      apoderado: {
        tipo: "juridica",
        sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
        sociedad_nit: "900666582-8",
        representantes: [
          { nombre: "LINA CAMPOS", cedula: "1234567", es_firmante: true },
          { nombre: "KLEITMAN MUÑOZ", cedula: "7654321", es_firmante: false },
        ],
      },
      poderdante: {
        nombre: "BANCO DAVIVIENDA S.A.",
        representante_legal: { nombre: "FÉLIX ROZO CAGUA", cedula: "79382406" },
      },
      instrumento_poder: {
        escritura_num: "16390",
        notaria: "NOTARÍA 29 BOGOTÁ",
        notario_encargado_nombre: "SILVIA E. PALACIOS MARTINEZ",
      },
      has_apoderado_banco_v3: true,
      motivos_incompletitud: [],
    };
    const src_pb = {
      // Edición manual: sólo tocó nombre y género.
      apoderado_nombre: "LINA MARIA CAMPOS",
      apoderado_genero: "F" as const,
    };
    const out = hydratePoderBanco(ia_pb, src_pb);

    // Planos: la edición manual gana.
    expect(out.apoderado_nombre).toBe("LINA MARIA CAMPOS");
    // Planos no editados: fallback a IA.
    expect(out.apoderado_cedula).toBe("1234567");
    expect(out.apoderado_escritura).toBe("16390");
    expect(out.apoderado_notaria_poder).toBe("NOTARÍA 29 BOGOTÁ");

    // Bloque profundo: preservado tal cual.
    expect((out.apoderado as Record<string, unknown>)?.sociedad_razon_social).toBe("CONECTIVA GLOBAL S.A.S.");
    expect((out.apoderado as Record<string, unknown>)?.sociedad_nit).toBe("900666582-8");
    expect(((out.apoderado as { representantes: unknown[] })?.representantes)).toHaveLength(2);
    expect((out.poderdante as Record<string, unknown>)?.nombre).toBe("BANCO DAVIVIENDA S.A.");
    expect((out.instrumento_poder as Record<string, unknown>)?.notario_encargado_nombre).toBe("SILVIA E. PALACIOS MARTINEZ");
    expect(out.has_apoderado_banco_v3).toBe(true);
  });

  it("persona natural directa: no inventa campos", () => {
    const ia_pb = {
      apoderado_nombre: "JUAN PÉREZ",
      apoderado_cedula: "80000",
      apoderado: { tipo: "natural", nombre: "JUAN PÉREZ", cedula: "80000" },
    };
    const src_pb = {};
    const out = hydratePoderBanco(ia_pb, src_pb);
    expect(out.apoderado_nombre).toBe("JUAN PÉREZ");
    expect((out.apoderado as Record<string, unknown>)?.tipo).toBe("natural");
    expect((out.apoderado as Record<string, unknown>)?.sociedad_razon_social).toBeUndefined();
    expect(out.poderdante).toBeUndefined();
  });

  it("superconjunto: toda clave de ia_pb no editada por src_pb se preserva", () => {
    const ia_pb = {
      apoderado_nombre: "Y",
      apoderado_cedula: "111",
      apoderado: { tipo: "juridica" },
      poderdante: { nombre: "BANCO" },
      facultades: { general: true },
      motivos_incompletitud: ["fecha_ilegible"],
    };
    const src_pb = { apoderado_nombre: "X" };
    const out = hydratePoderBanco(ia_pb, src_pb);
    for (const k of Object.keys(ia_pb) as (keyof typeof ia_pb)[]) {
      if (k === "apoderado_nombre") continue; // sí fue editado
      expect(out[k]).toEqual(ia_pb[k]);
    }
  });

  it("sobreescritura plana: src_pb gana sobre ia_pb", () => {
    const out = hydratePoderBanco(
      { apoderado_nombre: "IA", apoderado_cedula: "111" },
      { apoderado_nombre: "MANUAL" },
    );
    expect(out.apoderado_nombre).toBe("MANUAL");
    expect(out.apoderado_cedula).toBe("111");
  });
});
