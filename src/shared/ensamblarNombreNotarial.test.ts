import { describe, it, expect } from "vitest";
import { ensamblarNombreNotarial } from "@shared/ensamblarNombreNotarial";

describe("ensamblarNombreNotarial", () => {
  it("caso Alejandra: reordena APELLIDOS+NOMBRES → NOMBRES APELLIDOS", () => {
    expect(
      ensamblarNombreNotarial({ apellidos: "DIAZ GARCIA", nombres: "MARGARITA IBETH" }),
    ).toBe("MARGARITA IBETH DIAZ GARCIA");
  });

  it("fallback legacy: solo `nombre` verbatim sin crash", () => {
    expect(
      ensamblarNombreNotarial({ nombre: "DIAZ GARCIA MARGARITA IBETH" }),
    ).toBe("DIAZ GARCIA MARGARITA IBETH");
  });

  it("uno vacío: cae al legacy sin espacio huérfano", () => {
    expect(
      ensamblarNombreNotarial({ apellidos: "", nombres: "MARIA", nombre: "MARIA LOPEZ" }),
    ).toBe("MARIA LOPEZ");
  });

  it("todos vacíos: string vacío, sin crash", () => {
    expect(ensamblarNombreNotarial({})).toBe("");
    expect(ensamblarNombreNotarial(null)).toBe("");
    expect(ensamblarNombreNotarial(undefined)).toBe("");
  });

  it("trim de whitespace", () => {
    expect(
      ensamblarNombreNotarial({ apellidos: "  RUIZ  ", nombres: "  PEDRO  " }),
    ).toBe("PEDRO RUIZ");
  });

  it("uppercase idempotente", () => {
    expect(
      ensamblarNombreNotarial({ apellidos: "diaz garcia", nombres: "margarita ibeth" }),
    ).toBe("MARGARITA IBETH DIAZ GARCIA");
  });

  it("apellido con partícula + nombre compuesto: concatena sin parsear", () => {
    expect(
      ensamblarNombreNotarial({ apellidos: "DE LA CRUZ", nombres: "MARIA JOSE" }),
    ).toBe("MARIA JOSE DE LA CRUZ");
  });

  it("solo apellidos sin nombres: fallback a legacy `nombre`", () => {
    expect(
      ensamblarNombreNotarial({ apellidos: "PEREZ LOPEZ", nombre: "PEREZ LOPEZ JUAN" }),
    ).toBe("PEREZ LOPEZ JUAN");
  });
});
