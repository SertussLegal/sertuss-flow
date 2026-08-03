import { describe, it, expect } from "vitest";
import { botonMinutaEstado, type EntradaBotonMinuta } from "./botonMinutaEstado";

const e = (over: Partial<EntradaBotonMinuta> = {}): EntradaBotonMinuta => ({
  prioritarias: 0,
  generando: false,
  generadoEnSesion: false,
  isDirty: false,
  ...over,
});

describe("botonMinutaEstado — regla de oro", () => {
  it("al cargar la página SIEMPRE arranca en 'generar', nunca en 'descargar'", () => {
    expect(botonMinutaEstado(e()).estado).toBe("generar");
  });

  it("aunque exista un docx previo, sin generación en sesión no hay descarga", () => {
    // `generadoEnSesion` es la ÚNICA fuente: no existe input de "docExiste".
    expect(botonMinutaEstado(e({ generadoEnSesion: false })).estado).toBe("generar");
  });

  it("tras generar en la sesión → 'descargar'", () => {
    expect(botonMinutaEstado(e({ generadoEnSesion: true })).estado).toBe("descargar");
  });

  it("editar después de generar vuelve a 'generar'", () => {
    expect(botonMinutaEstado(e({ generadoEnSesion: true, isDirty: true })).estado).toBe("generar");
  });
});

describe("botonMinutaEstado — precedencia", () => {
  it("las prioritarias ganan sobre 'descargar'", () => {
    const r = botonMinutaEstado(e({ prioritarias: 2, generadoEnSesion: true }));
    expect(r.estado).toBe("pendientes");
    expect(r.label).toBe("Acciones pendientes (2)");
    expect(r.tono).toBe("ambar");
    expect(r.disabled).toBe(false);
  });

  it("las prioritarias ganan sobre 'generando'", () => {
    expect(botonMinutaEstado(e({ prioritarias: 1, generando: true })).estado).toBe("pendientes");
  });

  it("'generando' deshabilita el botón", () => {
    const r = botonMinutaEstado(e({ generando: true }));
    expect(r.estado).toBe("generando");
    expect(r.disabled).toBe(true);
    expect(r.tono).toBe("espera");
  });

  it("'generando' gana sobre 'descargar'", () => {
    expect(botonMinutaEstado(e({ generando: true, generadoEnSesion: true })).estado).toBe("generando");
  });
});
