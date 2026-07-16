// Coherencia intra-documento de la sección `inmueble` del Certificado de
// Tradición. Cubre transposiciones de dígitos en dirección catastral y
// matrícula, y confirma que engancha con `HARD_BLOCK_WARNING_SUFFIXES` sin
// migración de constantes.
import { describe, it, expect } from "vitest";
import {
  validateInmuebleCoherencia,
  normalizeDireccionForCompare,
  normalizeMatriculaForCompare,
} from "../../supabase/functions/_shared/isomorphic/certificadoInmuebleValidate";
import { isHardBlockCoherenciaWarning } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

const inmuebleWith = (patch: Record<string, unknown>) => ({
  matricula_inmobiliaria: "50C-1572091",
  nomenclatura_predio: "CARRERA CIENTO CUATRO NÚMERO TRECE C - CINCO (104 No. 13C-05)",
  ...patch,
});

describe("validateInmuebleCoherencia", () => {
  it("1. Caso ancla real 7058: 13C-05 (x2) vs 13C-09 (x1) → dispara direccion_menciones_incoherentes + hard-block", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_1", valor: "KR 104 13C-05 CA 119", pagina: 1 },
        { seccion: "direccion_inmueble_2", valor: "KR 104 13C-05 CA 119", pagina: 1 },
        { seccion: "anotacion_0205",       valor: "KR 104 13C-09 CA 119", pagina: 4 },
      ],
    });
    const { warnings, suspicious } = validateInmuebleCoherencia(inmueble);
    expect(warnings).toContain("inmueble_direccion_menciones_incoherentes");
    expect(suspicious.has("inmueble.menciones_direccion")).toBe(true);
    expect(suspicious.has("inmueble.nomenclatura_predio")).toBe(true);
    expect(isHardBlockCoherenciaWarning("inmueble_direccion_menciones_incoherentes")).toBe(true);
  });

  it("2. 3 menciones consistentes → no dispara", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_1", valor: "KR 104 13C-05 CA 119" },
        { seccion: "direccion_inmueble_2", valor: "KR 104 13C-05 CA 119" },
        { seccion: "anotacion_0205",       valor: "KR 104 13C-05 CA 119" },
      ],
    });
    const { warnings } = validateInmuebleCoherencia(inmueble);
    expect(warnings).not.toContain("inmueble_direccion_menciones_incoherentes");
  });

  it("3. 1 sola mención → no dispara (evidencia insuficiente)", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [{ seccion: "direccion_inmueble_1", valor: "KR 104 13C-05 CA 119" }],
    });
    const { warnings } = validateInmuebleCoherencia(inmueble);
    expect(warnings).not.toContain("inmueble_direccion_menciones_incoherentes");
  });

  it("4. Normalización de formato dirección (espacios/guiones) → no dispara", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_1", valor: "CL 59 SUR 60 84" },
        { seccion: "direccion_inmueble_2", valor: "CL 59 SUR 60-84" },
        { seccion: "anotacion_0205",       valor: "CL 59 SUR 60 - 84" },
      ],
    });
    const { warnings } = validateInmuebleCoherencia(inmueble);
    expect(warnings).not.toContain("inmueble_direccion_menciones_incoherentes");
  });

  it("5. Matrícula: transposición 1572091 vs 1572081 → dispara matricula_menciones_incoherentes", () => {
    const inmueble = inmuebleWith({
      menciones_matricula: [
        { seccion: "encabezado",     valor: "50C-1572091" },
        { seccion: "pie_pagina_1",   valor: "50C-1572091" },
        { seccion: "anotacion_0205", valor: "50C-1572081" },
      ],
    });
    const { warnings, suspicious } = validateInmuebleCoherencia(inmueble);
    expect(warnings).toContain("inmueble_matricula_menciones_incoherentes");
    expect(suspicious.has("inmueble.menciones_matricula")).toBe(true);
    expect(suspicious.has("inmueble.matricula_inmobiliaria")).toBe(true);
    expect(isHardBlockCoherenciaWarning("inmueble_matricula_menciones_incoherentes")).toBe(true);
  });

  it("6. Matrícula: solo cambia el formato (guion/espacio) → no dispara", () => {
    const inmueble = inmuebleWith({
      menciones_matricula: [
        { seccion: "encabezado",     valor: "50C-1572091" },
        { seccion: "pie_pagina_1",   valor: "50C 1572091" },
        { seccion: "anotacion_0205", valor: "50C1572091" },
      ],
    });
    const { warnings } = validateInmuebleCoherencia(inmueble);
    expect(warnings).not.toContain("inmueble_matricula_menciones_incoherentes");
  });

  it("7. NO_LEGIBLE parcial + resto consistente → no dispara", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_1", valor: "NO_LEGIBLE" },
        { seccion: "direccion_inmueble_2", valor: "KR 104 13C-05 CA 119" },
        { seccion: "anotacion_0205",       valor: "KR 104 13C-05 CA 119" },
      ],
      menciones_matricula: [
        { seccion: "encabezado",     valor: "NO_LEGIBLE" },
        { seccion: "pie_pagina_1",   valor: "50C-1572091" },
      ],
    });
    const { warnings } = validateInmuebleCoherencia(inmueble);
    expect(warnings).not.toContain("inmueble_direccion_menciones_incoherentes");
    expect(warnings).not.toContain("inmueble_matricula_menciones_incoherentes");
  });

  it("8. Contrato hard-block — sufijo _menciones_incoherentes ya cubierto", () => {
    expect(isHardBlockCoherenciaWarning("inmueble_direccion_menciones_incoherentes")).toBe(true);
    expect(isHardBlockCoherenciaWarning("inmueble_matricula_menciones_incoherentes")).toBe(true);
  });

  it("9. Payload legacy sin menciones_* → no dispara", () => {
    const inmueble = inmuebleWith({});
    const { warnings, suspicious } = validateInmuebleCoherencia(inmueble);
    expect(warnings).toEqual([]);
    expect(suspicious.size).toBe(0);
  });

  it("10. Normalizadores exportados funcionan aislados", () => {
    expect(normalizeDireccionForCompare("KR 104 13C-05 CA 119"))
      .toBe(normalizeDireccionForCompare("kr 104 13c 05 ca 119"));
    expect(normalizeMatriculaForCompare("50C-1572091"))
      .toBe(normalizeMatriculaForCompare("50c 1572091"));
    expect(normalizeMatriculaForCompare("50C-1572091"))
      .not.toBe(normalizeMatriculaForCompare("50C-1572081"));
  });
});
