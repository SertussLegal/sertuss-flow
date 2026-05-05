/**
 * Pruebas de regresión para `diffTagsVsData()`.
 * Blindan los conteos frente a:
 *  - Tags planos (mapped/missing/empty)
 *  - Loops simples
 *  - Sub-claves profundas dentro de loops
 *  - Loops anidados
 *  - Caso real "0 mapped / 120 missing / 134 unused"
 */

import { describe, it, expect } from "vitest";
import { diffTagsVsData, flattenStructuredData } from "./docxDebug";

const flat = (data: unknown) => flattenStructuredData(data);

describe("diffTagsVsData — tags planos", () => {
  it("clasifica mapped / empty / missing", () => {
    const data = { matricula: "50C-123", precio: "", anio: 2026 };
    const tags = ["matricula", "precio", "ciudad"];
    const d = diffTagsVsData(tags, flat(data));
    expect(d.mapped).toContain("matricula");
    expect(d.empty).toContain("precio");
    expect(d.missing).toEqual(["ciudad"]);
  });

  it("marca claves sin uso como unused", () => {
    const data = { matricula: "x", aliasMuerto: "y" };
    const d = diffTagsVsData(["matricula"], flat(data));
    expect(d.unused).toEqual(["aliasMuerto"]);
  });
});

describe("diffTagsVsData — loops simples", () => {
  it("resuelve sub-clave hoja dentro de un loop", () => {
    const data = { vendedores: [{ nombre: "Ana" }, { nombre: "Luis" }] };
    const d = diffTagsVsData(["vendedores", "nombre"], flat(data));
    expect(d.scoped).toContain("nombre");
    expect(d.mapped).toContain("nombre");
    expect(d.mapped).toContain("vendedores");
    expect(d.unused).toEqual([]);
    expect(d.sectionsResolved.vendedores).toContain("nombre");
  });

  it("marca sub-clave como empty si TODOS los items están vacíos", () => {
    const data = { vendedores: [{ nombre: "" }, { nombre: "" }] };
    const d = diffTagsVsData(["nombre"], flat(data));
    expect(d.empty).toContain("nombre");
  });

  it("marca como mapped si solo algunos items tienen valor", () => {
    const data = { vendedores: [{ nombre: "Ana" }, { nombre: "" }] };
    const d = diffTagsVsData(["nombre"], flat(data));
    expect(d.mapped).toContain("nombre");
    expect(d.empty).not.toContain("nombre");
  });
});

describe("diffTagsVsData — sub-claves profundas", () => {
  it("resuelve {direccion.ciudad} dentro de un loop", () => {
    const data = {
      vendedores: [{ direccion: { ciudad: "Bogotá", calle: "Cra 7" } }],
    };
    const d = diffTagsVsData(["direccion.ciudad"], flat(data));
    expect(d.scoped).toContain("direccion.ciudad");
    expect(d.mapped).toContain("direccion.ciudad");
    expect(d.missing).not.toContain("direccion.ciudad");
  });
});

describe("diffTagsVsData — loops anidados", () => {
  it("resuelve {nombre} dentro de {#apoderados} dentro de {#compradores}", () => {
    const data = {
      compradores: [
        { apoderados: [{ nombre: "Pedro" }, { nombre: "Juana" }] },
        { apoderados: [{ nombre: "Mario" }] },
      ],
    };
    const d = diffTagsVsData(["compradores", "apoderados", "nombre"], flat(data));
    expect(d.mapped).toContain("compradores");
    expect(d.scoped).toContain("apoderados");
    expect(d.scoped).toContain("nombre");
    expect(d.unused).toEqual([]);
  });

  it("no produce 'unused' para sub-claves consumidas por loop scoped", () => {
    const data = { vendedores: [{ nombre: "Ana", cedula: "123" }] };
    const d = diffTagsVsData(["nombre", "cedula"], flat(data));
    expect(d.unused).toEqual([]);
  });
});

describe("diffTagsVsData — regresión: caso real reportado", () => {
  it("escenario del usuario produce conteos coherentes (no 0 mapped)", () => {
    const data = {
      vendedores: [
        { nombre: "Ana", cedula: "111", direccion: { ciudad: "Bogotá" } },
      ],
      compradores: [
        { nombre: "Luis", cedula: "222", apoderados: [{ nombre: "Pedro", cedula: "333" }] },
      ],
      inmueble: { matricula: "50C-1", chip: "AAA000" },
      notario: "Juan",
    };
    const tags = [
      "vendedores", "compradores", "apoderados",
      "nombre", "cedula", "direccion.ciudad",
      "inmueble", "notario",
    ];
    const d = diffTagsVsData(tags, flat(data));
    expect(d.mapped.length).toBeGreaterThan(0);
    expect(d.missing).toEqual([]);
    // Sub-claves de array no deben aparecer como unused.
    expect(d.unused.find((u) => u.includes("[0]"))).toBeUndefined();
  });
});
