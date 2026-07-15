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
