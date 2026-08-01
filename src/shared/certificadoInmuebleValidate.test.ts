// Coherencia intra-documento de la sección `inmueble` del Certificado de
// Tradición. Cubre transposiciones de dígitos en dirección catastral y
// matrícula, y confirma que engancha con `HARD_BLOCK_WARNING_SUFFIXES` sin
// migración de constantes.
import { describe, it, expect } from "vitest";
import {
  validateInmuebleCoherencia,
  tieneMencionCatastral,
  normalizeDireccionForCompare,
  normalizeMatriculaForCompare,
} from "../../supabase/functions/_shared/isomorphic/certificadoInmuebleValidate";
import { isHardBlockCoherenciaWarning } from "../../supabase/functions/_shared/isomorphic/poderBancoExtractor/validate";

const inmuebleWith = (patch: Record<string, unknown>) => ({
  matricula_inmobiliaria: "50C-1572091",
  nomenclatura_predio: "CARRERA CIENTO CUATRO NÚMERO TRECE C - CINCO (104 No. 13C-05)",
  ...patch,
});

// Los 6 trámites históricos reales (valores exactos de producción,
// 2026-08-01). Todos tienen 1 mención urbanística (`direccion_inmueble_1`) y
// 1 catastral (`direccion_inmueble_2`) → grupos distintos → NO deben disparar.
const HISTORICOS: Array<{ id: string; menciones: Array<{ seccion: string; valor: string }> }> = [
  {
    id: "a8af7200",
    menciones: [
      { seccion: "direccion_inmueble_1", valor: "CALLE 61 A SUR #100 A 73 CASA INT 53 AGRUP LA ALAMEDA DEL RIO AGRUP 9 AGRUPACION LA ALAMEDA DEL RIO" },
      { seccion: "direccion_inmueble_2", valor: "CS 61 A SUR # 100A 73 CA 53 (DIRECCION CATASTRAL)" },
    ],
  },
  {
    id: "eff6f046",
    menciones: [
      { seccion: "direccion_inmueble_1", valor: "1) TRANSVERSAL 79 11B-15 APARTAMENTO 401 INTERIOR 7 TIPO 1.4 A DERECHO CONJUNTO RESIDENCIAL PARQUES DE CASTILLA 8 P.H." },
      { seccion: "direccion_inmueble_2", valor: "2) CL 11B BIS A 78 23 IN 7 AP 401 (DIRECCION CATASTRAL)" },
    ],
  },
  {
    id: "3ba6902a",
    menciones: [
      { seccion: "direccion_inmueble_1", valor: "CARRERA 106 A 156-98/96 APARTAMENTO 102 INTERIOR 6" },
      { seccion: "direccion_inmueble_2", valor: "KR 106A 156 98 IN 6 AP 102 (DIRECCION CATASTRAL)" },
    ],
  },
  {
    id: "50d5488a",
    menciones: [
      { seccion: "direccion_inmueble_1", valor: "CARRERA 98A 15A-70 APARTAMENTO 203 INT 11 CONJUNTO RESIDENCIAL SABANAGRANDE RESERVADO 3MZ 2B P.H." },
      { seccion: "direccion_inmueble_2", valor: "KR 98A 15A 70 IN 11 AP 203 (DIRECCION CATASTRAL)" },
    ],
  },
  {
    id: "982af289",
    menciones: [
      { seccion: "direccion_inmueble_1", valor: "CO RESIDENCIAL LA REQUILINA ACCESO PEATONAL TRES QUEBRADAS UG1 LT2 REQUILINA APT 401 TO 38" },
      { seccion: "direccion_inmueble_2", valor: "KR 3A 122 25 SUR TO 38 AP 401 (DIRECCION CATASTRAL)" },
    ],
  },
  {
    id: "7366ff63",
    menciones: [
      { seccion: "escritura_pag_7", valor: "Transversal y Noventa y Siete A (97 A) número dos - setenta (2-70)" },
    ],
  },
];

describe("validateInmuebleCoherencia", () => {
  it.each(HISTORICOS)(
    "1. Histórico real $id: urbanística vs catastral en grupos distintos → NO dispara",
    ({ menciones }) => {
      const { warnings, suspicious } = validateInmuebleCoherencia(inmuebleWith({ menciones_direccion: menciones }));
      expect(warnings).not.toContain("inmueble_direccion_menciones_incoherentes");
      expect(suspicious.has("inmueble.menciones_direccion")).toBe(false);
    },
  );

  it("1b. Sintético: 2 menciones del MISMO índice con valores distintos → SÍ dispara + hard-block", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_2", valor: "KR 104 13C-05 CA 119 (DIRECCION CATASTRAL)", pagina: 1 },
        { seccion: "direccion_inmueble_2", valor: "KR 104 13C-09 CA 119 (DIRECCION CATASTRAL)", pagina: 4 },
        { seccion: "direccion_inmueble_1", valor: "CARRERA 104 13C-05 CASA 119" },
      ],
    });
    const { warnings, suspicious } = validateInmuebleCoherencia(inmueble);
    expect(warnings).toContain("inmueble_direccion_menciones_incoherentes");
    expect(suspicious.has("inmueble.menciones_direccion")).toBe(true);
    expect(suspicious.has("inmueble.nomenclatura_predio")).toBe(true);
    expect(isHardBlockCoherenciaWarning("inmueble_direccion_menciones_incoherentes")).toBe(true);
  });

  it("2. 3 menciones del mismo grupo consistentes → no dispara", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_1", valor: "KR 104 13C-05 CA 119" },
        { seccion: "direccion_inmueble_1", valor: "KR 104 13C-05 CA 119" },
        { seccion: "direccion_inmueble_1", valor: "KR 104 13C-05 CA 119" },
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

  it("4. Normalización de formato dirección dentro del mismo grupo → no dispara", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_1", valor: "CL 59 SUR 60 84" },
        { seccion: "direccion_inmueble_1", valor: "CL 59 SUR 60-84" },
        { seccion: "direccion_inmueble_1", valor: "CL 59 SUR 60 - 84" },
      ],
    });
    const { warnings } = validateInmuebleCoherencia(inmueble);
    expect(warnings).not.toContain("inmueble_direccion_menciones_incoherentes");
  });

  it("4b. Anotación libre vs direccion_inmueble_1 con valores distintos → NO dispara (grupos distintos)", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_1", valor: "CARRERA 104 13C-05 CASA 119" },
        { seccion: "anotacion_0205", valor: "CARRERA 104 13C-09 CASA 119" },
      ],
    });
    const { warnings, suspicious } = validateInmuebleCoherencia(inmueble);
    expect(warnings).not.toContain("inmueble_direccion_menciones_incoherentes");
    expect(suspicious.has("inmueble.menciones_direccion")).toBe(false);
  });

  it("4c. Dos menciones libres distintas con valores distintos → SÍ dispara (mismo grupo LIBRE)", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "anotacion_0205", valor: "CARRERA 104 13C-05 CASA 119" },
        { seccion: "anotacion_0310", valor: "CARRERA 104 13C-09 CASA 119" },
      ],
    });
    const { warnings, suspicious } = validateInmuebleCoherencia(inmueble);
    expect(warnings).toContain("inmueble_direccion_menciones_incoherentes");
    expect(suspicious.has("inmueble.menciones_direccion")).toBe(true);
  });

  it("4d. Bug corregido: 'anotacion_0205' NO colisiona con índice 205", () => {
    const inmueble = inmuebleWith({
      menciones_direccion: [
        { seccion: "direccion_inmueble_205", valor: "CARRERA 104 13C-05 CASA 119" },
        { seccion: "anotacion_0205", valor: "CARRERA 104 13C-09 CASA 119" },
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

  it("11. tieneMencionCatastral: true en los 5 históricos con certificado, false sin marcador", () => {
    for (const h of HISTORICOS.slice(0, 5)) {
      expect(tieneMencionCatastral(inmuebleWith({ menciones_direccion: h.menciones }))).toBe(true);
    }
    expect(tieneMencionCatastral(inmuebleWith({ menciones_direccion: HISTORICOS[5]!.menciones }))).toBe(false);
    expect(tieneMencionCatastral(inmuebleWith({}))).toBe(false);
    expect(tieneMencionCatastral(null)).toBe(false);
    expect(
      tieneMencionCatastral(inmuebleWith({ menciones_direccion: [{ seccion: "x", valor: "KR 1 2 3 (DIRECCIÓN CATASTRAL)" }] })),
    ).toBe(true);
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
