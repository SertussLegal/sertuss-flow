// setPoderdantePatch — helper puro del editor de UI. Verifica el blindaje
// contra el bug histórico de "override borra bloque profundo": editar la
// cédula escalar NUNCA debe perder `menciones_rl` ni otros escalares.
import { describe, it, expect } from "vitest";
import { setPoderdantePatch } from "./CancelacionValidar";

describe("setPoderdantePatch — editor de UI poderdante", () => {
  it("edita representante_legal_cedula sin borrar menciones_rl ni otros escalares", () => {
    const prev = {
      entidad_nombre: "DAVIVIENDA S.A.",
      entidad_nit: "860.034.313-7",
      representante_legal_nombre: "FELIX ROZO CAGUA",
      representante_legal_cedula: "79392406",
      representante_legal_cargo: "APODERADO",
      menciones_rl: [
        { seccion: "cuerpo_poder", cedula: "79392406", pagina: 1 },
        { seccion: "certificado_superfinanciera", cedula: "79382406", pagina: 12 },
      ],
    };
    const next = setPoderdantePatch(prev, { representante_legal_cedula: "79382406" });
    expect(next.representante_legal_cedula).toBe("79382406");
    expect(next.entidad_nombre).toBe("DAVIVIENDA S.A.");
    expect(next.entidad_nit).toBe("860.034.313-7");
    expect(next.representante_legal_nombre).toBe("FELIX ROZO CAGUA");
    expect(next.representante_legal_cargo).toBe("APODERADO");
    expect(Array.isArray(next.menciones_rl)).toBe(true);
    expect((next.menciones_rl as unknown[]).length).toBe(2);
  });

  it("acepta prev=null/undefined y devuelve solo el patch", () => {
    expect(setPoderdantePatch(null, { entidad_nit: "1" })).toEqual({ entidad_nit: "1" });
    expect(setPoderdantePatch(undefined, { entidad_nit: "1" })).toEqual({ entidad_nit: "1" });
  });

  it("no muta el objeto prev original", () => {
    const prev = { entidad_nombre: "X", menciones_rl: [{ cedula: "1" }] };
    const next = setPoderdantePatch(prev, { entidad_nombre: "Y" });
    expect(prev.entidad_nombre).toBe("X");
    expect(next.entidad_nombre).toBe("Y");
    // El array por referencia se conserva (spread superficial es OK — no lo
    // reasignamos ni lo mutamos desde la UI).
    expect(next.menciones_rl).toBe(prev.menciones_rl);
  });

  it("preserva claves desconocidas del bloque profundo v6 (poderdante._algo)", () => {
    const prev = {
      entidad_nombre: "X",
      _custom_deep_field: { foo: "bar" },
      menciones_rl: [{ cedula: "1" }],
    };
    const next = setPoderdantePatch(prev, { entidad_nombre: "Y" });
    expect((next as Record<string, unknown>)._custom_deep_field).toEqual({ foo: "bar" });
    expect(next.menciones_rl).toEqual([{ cedula: "1" }]);
  });
});
