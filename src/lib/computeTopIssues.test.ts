import { describe, it, expect } from "vitest";
import { computeTopIssues } from "./computeTopIssues";

const persona = (over: any = {}) => ({
  nombre_completo: "Juan Perez",
  numero_cedula: "1234",
  lugar_expedicion: "Bogotá",
  es_persona_juridica: false,
  ...over,
});

const baseInput = () => ({
  tipoActo: "Compraventa",
  vendedores: [persona()],
  compradores: [persona({ nombre_completo: "Ana Ruiz", numero_cedula: "5678" })],
  inmueble: {
    matricula_inmobiliaria: "50N-123",
    identificador_predial: "AAA000",
    municipio: "Bogotá",
  },
  actos: { valor_compraventa: "100000000", es_hipoteca: false, valor_hipoteca: "" } as any,
  notariaTramite: { numero_notaria: "10", circulo: "Bogotá", nombre_notario: "X" },
});

describe("computeTopIssues", () => {
  it("no issues → array vacío", () => {
    expect(computeTopIssues(baseInput())).toEqual([]);
  });

  it("R1 persona sin cédula", () => {
    const i = baseInput();
    i.vendedores = [persona({ numero_cedula: "" })];
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R1_persona_sin_id")).toBe(true);
  });

  it("R2 sin vendedores", () => {
    const i = baseInput();
    i.vendedores = [];
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R2_sin_vendedores")).toBe(true);
  });

  it("R2 sin compradores", () => {
    const i = baseInput();
    i.compradores = [{}];
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R2_sin_compradores")).toBe(true);
  });

  it("R3 inmueble sin matrícula", () => {
    const i = baseInput();
    i.inmueble.matricula_inmobiliaria = "";
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R3_sin_matricula")).toBe(true);
  });

  it("R4 cuantía compraventa faltante", () => {
    const i = baseInput();
    i.actos.valor_compraventa = "";
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R4_cuantia_compraventa")).toBe(true);
  });

  it("R4 cuantía hipoteca faltante", () => {
    const i = baseInput();
    i.actos.es_hipoteca = true;
    i.actos.valor_hipoteca = "";
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R4_cuantia_hipoteca")).toBe(true);
  });

  it("R5 CHIP faltante en Bogotá", () => {
    const i = baseInput();
    i.inmueble.identificador_predial = "";
    i.inmueble.municipio = "Bogotá";
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R5_chip_faltante")).toBe(true);
  });

  it("R5 catastral faltante fuera de Bogotá", () => {
    const i = baseInput();
    i.inmueble.identificador_predial = "";
    i.inmueble.municipio = "Medellín";
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R5_catastral_faltante")).toBe(true);
  });

  it("R6 lugar_expedicion faltante", () => {
    const i = baseInput();
    i.vendedores = [persona({ lugar_expedicion: "" })];
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R6_lugar_expedicion")).toBe(true);
  });

  it("R7 notaría incompleta", () => {
    const i = baseInput();
    i.notariaTramite = { numero_notaria: "", circulo: "", nombre_notario: "" };
    const r = computeTopIssues(i);
    expect(r.some((x) => x.codigo_regla === "R7_notaria_incompleta")).toBe(true);
  });

  it("trunca a 3 y ordena por severidad", () => {
    const i = baseInput();
    i.vendedores = [];
    i.compradores = [];
    i.inmueble.matricula_inmobiliaria = "";
    i.inmueble.identificador_predial = "";
    i.actos.valor_compraventa = "";
    const r = computeTopIssues(i, 3);
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.nivel === "error")).toBe(true);
  });
});
