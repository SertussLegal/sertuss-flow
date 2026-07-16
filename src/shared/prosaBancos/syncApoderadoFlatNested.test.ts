import { describe, it, expect } from "vitest";
import { syncApoderadoFlatWithNested } from "@shared/prosaBancos/syncApoderadoFlatNested";
import { isHardBlockCoherenciaWarning } from "@shared/poderBancoExtractor/validate";

describe("syncApoderadoFlatWithNested", () => {
  it("no toca nada cuando el anidado está vacío (V6 apagado)", () => {
    const pb = {
      apoderado_nombre: "JUAN PÉREZ",
      apoderado_cedula: "1234",
      apoderado: {}, // V6 off / OCR sin bloque profundo
    };
    const { synced, warnings, suspicious } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toEqual([]);
    expect(suspicious.size).toBe(0);
    expect((synced.apoderado as Record<string, unknown>).nombre).toBeUndefined();
  });

  it("no dispara warning cuando plano y anidado coinciden tras normalizar", () => {
    const pb = {
      apoderado_nombre: "JUAN PÉREZ",
      apoderado_cedula: "1234",
      apoderado: { nombre: "  juan pérez  ", cedula: "1234", tipo: "natural" },
    };
    const { warnings, suspicious } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toEqual([]);
    expect(suspicious.size).toBe(0);
  });

  it("sobrescribe anidado con plano cuando difieren (natural)", () => {
    const pb = {
      apoderado_nombre: "JUAN PÉREZ RESTREPO",
      apoderado_cedula: "9999",
      apoderado: { nombre: "JUAN PEREZ", cedula: "1234", tipo: "natural" },
    };
    const { synced, warnings, suspicious } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toContain("apoderado_nombre_divergencia_plano_anidado");
    expect(warnings).toContain("apoderado_cedula_divergencia_plano_anidado");
    expect(suspicious.has("apoderado_nombre")).toBe(true);
    expect(suspicious.has("apoderado_cedula")).toBe(true);
    const apo = synced.apoderado as Record<string, unknown>;
    expect(apo.nombre).toBe("JUAN PÉREZ RESTREPO");
    expect(apo.cedula).toBe("9999");
  });

  it("solo emite warning de cédula si únicamente la cédula difiere", () => {
    const pb = {
      apoderado_nombre: "JUAN PÉREZ",
      apoderado_cedula: "9999",
      apoderado: { nombre: "JUAN PÉREZ", cedula: "1234", tipo: "natural" },
    };
    const { warnings } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toEqual(["apoderado_cedula_divergencia_plano_anidado"]);
  });

  it("jurídica con un firmante único: sobrescribe representante Y snapshot anidado", () => {
    const pb = {
      apoderado_nombre: "FIRMANTE REAL",
      apoderado_cedula: "555",
      apoderado: {
        tipo: "juridica",
        nombre: "OTRO",
        cedula: "111",
        representantes: [{ nombre: "OTRO", cedula: "111", es_firmante: true }],
      },
    };
    const { synced, warnings, suspicious } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toContain("apoderado_nombre_divergencia_plano_anidado");
    expect(warnings).toContain("apoderado_cedula_divergencia_plano_anidado");
    expect(suspicious.has("apoderado_nombre")).toBe(true);
    const apo = synced.apoderado as Record<string, unknown>;
    const reps = apo.representantes as Array<Record<string, unknown>>;
    expect(reps[0].nombre).toBe("FIRMANTE REAL");
    expect(reps[0].cedula).toBe("555");
    expect(apo.nombre).toBe("FIRMANTE REAL");
    expect(apo.cedula).toBe("555");
  });

  it("jurídica con múltiples firmantes marca ambigüedad + suspicious", () => {
    const pb = {
      apoderado_nombre: "PRIMERO",
      apoderado_cedula: "111",
      apoderado: {
        tipo: "juridica",
        representantes: [
          { nombre: "PRIMERO", cedula: "111", es_firmante: true },
          { nombre: "SEGUNDO", cedula: "222", es_firmante: true },
        ],
      },
    };
    const { warnings, suspicious } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toContain("apoderado_multiple_firmantes_ambiguo");
    expect(suspicious.has("apoderado_nombre")).toBe(true);
  });

  it("jurídica sin es_firmante: fallback al primer representante con nombre", () => {
    const pb = {
      apoderado_nombre: "NUEVO NOMBRE",
      apoderado_cedula: "999",
      apoderado: {
        tipo: "juridica",
        representantes: [{ nombre: "VIEJO", cedula: "111" }],
      },
    };
    const { synced, warnings } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toContain("apoderado_nombre_divergencia_plano_anidado");
    const reps = (synced.apoderado as Record<string, unknown>).representantes as Array<Record<string, unknown>>;
    expect(reps[0].nombre).toBe("NUEVO NOMBRE");
  });

  it("idempotente: correr dos veces produce el mismo estado y warnings", () => {
    const pb = {
      apoderado_nombre: "JUAN PÉREZ RESTREPO",
      apoderado_cedula: "9999",
      apoderado: { nombre: "JUAN PEREZ", cedula: "1234", tipo: "natural" },
    };
    const first = syncApoderadoFlatWithNested(pb);
    const second = syncApoderadoFlatWithNested(first.synced);
    // Segunda corrida sobre el resultado ya sincronizado no debe emitir warnings.
    expect(second.warnings).toEqual([]);
    expect((second.synced.apoderado as Record<string, unknown>).nombre).toBe("JUAN PÉREZ RESTREPO");
  });

  it("trata `null` literal (string tóxico) como anidado vacío-corrupto y corrige", () => {
    const pb = {
      apoderado_nombre: "JUAN PÉREZ",
      apoderado_cedula: "1234",
      apoderado: { nombre: "null", cedula: "undefined", tipo: "natural" },
    };
    const { synced, warnings } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toContain("apoderado_nombre_divergencia_plano_anidado");
    expect(warnings).toContain("apoderado_cedula_divergencia_plano_anidado");
    const apo = synced.apoderado as Record<string, unknown>;
    expect(apo.nombre).toBe("JUAN PÉREZ");
    expect(apo.cedula).toBe("1234");
  });

  it("no muta la entrada original", () => {
    const pb = {
      apoderado_nombre: "NUEVO",
      apoderado: { nombre: "VIEJO", tipo: "natural" },
    };
    const snapshot = JSON.stringify(pb);
    syncApoderadoFlatWithNested(pb);
    expect(JSON.stringify(pb)).toBe(snapshot);
  });

  it("ningún warning nuevo es hard-block (no dispara revisión manual)", () => {
    expect(isHardBlockCoherenciaWarning("apoderado_nombre_divergencia_plano_anidado")).toBe(false);
    expect(isHardBlockCoherenciaWarning("apoderado_cedula_divergencia_plano_anidado")).toBe(false);
    expect(isHardBlockCoherenciaWarning("apoderado_multiple_firmantes_ambiguo")).toBe(false);
  });

  it("plano vacío no dispara warning aunque el anidado esté poblado", () => {
    const pb = {
      apoderado_nombre: "",
      apoderado_cedula: null,
      apoderado: { nombre: "OCR VALUE", cedula: "1234", tipo: "natural" },
    };
    const { warnings } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toEqual([]);
  });

  it("respeta tipo_override='juridica' aunque tipo sea 'natural'", () => {
    const pb = {
      apoderado_nombre: "FIRMANTE",
      apoderado_cedula: "555",
      apoderado: {
        tipo: "natural",
        tipo_override: "juridica",
        nombre: "OTRO",
        representantes: [{ nombre: "OTRO", cedula: "111", es_firmante: true }],
      },
    };
    const { synced, warnings } = syncApoderadoFlatWithNested(pb);
    expect(warnings).toContain("apoderado_nombre_divergencia_plano_anidado");
    const reps = (synced.apoderado as Record<string, unknown>).representantes as Array<Record<string, unknown>>;
    expect(reps[0].nombre).toBe("FIRMANTE");
  });
});
