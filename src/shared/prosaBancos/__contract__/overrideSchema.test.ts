// ============================================================================
// overrideSchema.test.ts — Sanitización idéntica en cliente y edge.
// ============================================================================

import { describe, it, expect } from "vitest";
import { OverrideSchema, sanitizeOverride, isOverrideForbidden, classifyOverrideError } from "@shared/prosaBancos/overrideSchema";

describe("overrideSchema: sanitización dura", () => {
  it("acepta un override mínimo con notas limpias", () => {
    const out = sanitizeOverride({
      notas_adicionales: "Aclaración adicional del apoderado.",
    });
    expect(out.notas_adicionales).toBe("Aclaración adicional del apoderado.");
  });

  it("rechaza tokens sucios en notas", () => {
    expect(() => sanitizeOverride({ notas_adicionales: "Ver ___________ pendiente." })).toThrow();
    expect(() => sanitizeOverride({ notas_adicionales: "Dato ilegible en original." })).toThrow();
    expect(() => sanitizeOverride({ notas_adicionales: "Valor: undefined" })).toThrow();
    expect(() => sanitizeOverride({ notas_adicionales: "N/A por ahora" })).toThrow();
  });

  it("rechaza intentos de redefinir marcadores canónicos", () => {
    expect(() => sanitizeOverride({ notas_adicionales: "COMPARECIÓ: OTRO NOMBRE" })).toThrow();
    expect(() => sanitizeOverride({ notas_adicionales: "PRIMERO.- redefinido" })).toThrow();
    expect(() => sanitizeOverride({ notas_adicionales: "NIT: 860.034.313-7 falsificado" })).toThrow();
  });

  it("rechaza notas > 2000 caracteres", () => {
    const long = "a".repeat(2001);
    expect(() => sanitizeOverride({ notas_adicionales: long })).toThrow();
  });

  it("acepta campos_editados válidos", () => {
    const out = sanitizeOverride({
      campos_editados: {
        sociedad_constitucion: { reforma_acta_numero: "5" },
        representante_legal_cargo: "PRESIDENTE",
      },
    });
    expect(out.campos_editados?.representante_legal_cargo).toBe("PRESIDENTE");
  });

  it("rechaza propiedades no declaradas (strict mode)", () => {
    expect(() =>
      OverrideSchema.parse({ notas_adicionales: "ok", inyectado: "x" }),
    ).toThrow();
  });

  it("isOverrideForbidden reporta el motivo", () => {
    expect(isOverrideForbidden("texto limpio").ok).toBe(true);
    const r = isOverrideForbidden("valor N/A pendiente");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("N/A");
  });
});

describe("classifyOverrideError", () => {
  const captureError = (input: unknown): unknown => {
    try {
      OverrideSchema.parse(input);
      return null;
    } catch (e) {
      return e;
    }
  };

  it("clasifica marcador canónico", () => {
    const err = captureError({ notas_adicionales: "Fragmento con COMPARECIÓ: pegado" });
    const info = classifyOverrideError(err);
    expect(info?.kind).toBe("canonical_marker");
    expect(info?.message).toContain("COMPARECIÓ:");
  });

  it("clasifica token prohibido", () => {
    const err = captureError({ notas_adicionales: "Valor null pendiente" });
    const info = classifyOverrideError(err);
    expect(info?.kind).toBe("forbidden_token");
  });

  it("clasifica largo excedido", () => {
    const err = captureError({ notas_adicionales: "x".repeat(2001) });
    const info = classifyOverrideError(err);
    expect(info?.kind).toBe("too_long");
  });

  it("devuelve null para errores no-Zod", () => {
    expect(classifyOverrideError(new Error("otro"))).toBeNull();
    expect(classifyOverrideError(null)).toBeNull();
    expect(classifyOverrideError("string")).toBeNull();
  });
});
