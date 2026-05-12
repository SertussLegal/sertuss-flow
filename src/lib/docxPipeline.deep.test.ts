/**
 * Test de regresión v3.2 — Recursividad universal de materializeDocxRenderData.
 *
 * Garantiza:
 *   - Profundidad arbitraria (3+ niveles) → claves planas con punto en raíz.
 *   - El objeto resultante es híbrido: conserva el árbol anidado intacto
 *     (loops siguen funcionando) y SUMA las llaves planas.
 *   - Los overrides manuales aplicados ANTES tienen prioridad absoluta sobre
 *     la materialización (no se sobrescriben).
 *   - El conteo de claves planas no se infla: claves nested + literal con
 *     el mismo path colapsan a una sola entrada (mismo string-key en el objeto).
 */

import { describe, it, expect } from "vitest";
import {
  materializeDocxRenderData,
  applyManualOverrides,
} from "./docxConsolidation";

describe("materializeDocxRenderData — profundidad arbitraria", () => {
  it("aplana antecedentes.escritura.fecha (3 niveles) en una clave dotted", () => {
    const data = {
      antecedentes: {
        escritura: {
          fecha: { dia: "15", mes: "marzo", anio: "2020" },
          numero: "1234",
        },
      },
    } as unknown as Record<string, unknown>;
    const out = materializeDocxRenderData(data) as Record<string, unknown>;

    // 3 niveles
    expect(out["antecedentes.escritura.fecha.dia"]).toBe("15");
    expect(out["antecedentes.escritura.fecha.mes"]).toBe("marzo");
    expect(out["antecedentes.escritura.fecha.anio"]).toBe("2020");
    // 2 niveles
    expect(out["antecedentes.escritura.numero"]).toBe("1234");
    // El árbol anidado se preserva 1:1
    expect(
      ((out.antecedentes as Record<string, Record<string, Record<string, string>>>)
        .escritura.fecha.dia),
    ).toBe("15");
  });

  it("aplana rph.notaria.numero (3 niveles) sin tocar el anidado", () => {
    const data = {
      rph: { notaria: { numero: "1", ciudad: "Bogotá" } },
    } as unknown as Record<string, unknown>;
    const out = materializeDocxRenderData(data) as Record<string, unknown>;
    expect(out["rph.notaria.numero"]).toBe("1");
    expect(out["rph.notaria.ciudad"]).toBe("Bogotá");
  });

  it("preserva arrays (vendedores) sin convertirlos en claves planas", () => {
    const data = {
      vendedores: [{ nombre: "Ana" }, { nombre: "Luis" }],
      inmueble: { matricula: "50C-1" },
    } as unknown as Record<string, unknown>;
    const out = materializeDocxRenderData(data) as Record<string, unknown>;
    expect(Array.isArray(out.vendedores)).toBe(true);
    expect((out.vendedores as Array<{ nombre: string }>)[0].nombre).toBe("Ana");
    // No se generan claves "vendedores.0.nombre" ni similares.
    expect(Object.keys(out).some((k) => k.startsWith("vendedores."))).toBe(false);
    expect(out["inmueble.matricula"]).toBe("50C-1");
  });

  it("override manual SOBREVIVE a la materialización (prioridad absoluta)", () => {
    const data = {
      inmueble: { matricula: "ORIGINAL" },
    } as unknown as import("./docxConsolidation").ConsolidatedDocxData;
    // Override manual: dual-write a anidado + literal con punto.
    const overridden = applyManualOverrides(data, {
      "inmueble.matricula": "99999999",
    });
    // Materialización corre DESPUÉS y respeta la clave literal pre-existente.
    const out = materializeDocxRenderData(overridden) as Record<string, unknown>;
    expect(out["inmueble.matricula"]).toBe("99999999");
    expect((out.inmueble as Record<string, unknown>).matricula).toBe("99999999");
  });

  it("no infla flatKeys: nested+literal con mismo path comparten una sola entrada", () => {
    // Simulamos lo que produce applyManualOverrides: ambas representaciones.
    const data = {
      inmueble: { matricula: "X" },
      "inmueble.matricula": "X",
    } as unknown as Record<string, unknown>;
    const out = materializeDocxRenderData(data) as Record<string, unknown>;
    // En JS, asignar a out["inmueble.matricula"] colisiona con la clave
    // literal pre-existente: una sola entrada en Object.keys.
    const dottedKeys = Object.keys(out).filter((k) => k === "inmueble.matricula");
    expect(dottedKeys).toHaveLength(1);
  });

  it("idempotencia: aplicar materialize 2x produce el mismo objeto", () => {
    const data = {
      a: { b: { c: "1" } },
    } as unknown as Record<string, unknown>;
    const once = materializeDocxRenderData(data) as Record<string, unknown>;
    const twice = materializeDocxRenderData(once) as Record<string, unknown>;
    expect(Object.keys(once).sort()).toEqual(Object.keys(twice).sort());
    expect(twice["a.b.c"]).toBe("1");
  });
});
