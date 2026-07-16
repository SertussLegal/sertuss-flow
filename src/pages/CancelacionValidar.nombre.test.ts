// Issue 3 — El nombre del deudor mostrado en la UI de validación debe ser
// el MISMO string que el backend imprime en la minuta. Antes del fix, la
// hidratación asignaba `nombre: nombreVerbatim` (formato registral
// "APELLIDOS NOMBRES") mientras `normalizeDeudores` en el backend reordenaba
// a "NOMBRES APELLIDOS" antes de imprimir → divergencia silenciosa.
//
// Este test valida el contrato de paridad: ambas rutas usan el mismo
// helper isomórfico `ensamblarNombreNotarial`. Los tests exhaustivos del
// helper viven en `src/shared/ensamblarNombreNotarial.test.ts`.

import { describe, it, expect } from "vitest";
import { ensamblarNombreNotarial } from "@shared/ensamblarNombreNotarial";

// Réplica local mínima de `normalizeDeudores` (backend) — sólo el segmento
// que produce el `nombre` final. Si el backend cambia el ensamblador, este
// test debe seguir pasando gracias al helper compartido.
function nombreImpresoEnMinuta(d: { apellidos?: string; nombres?: string; nombre?: string }): string {
  const apellidos = String(d?.apellidos ?? "").toUpperCase().trim();
  const nombres = String(d?.nombres ?? "").toUpperCase().trim();
  const nombreLegacy = String(d?.nombre ?? "").toUpperCase().trim();
  return (nombres && apellidos) ? `${nombres} ${apellidos}` : nombreLegacy;
}

describe("CancelacionValidar — nombre deudor UI ↔ minuta", () => {
  it("A. Hidratación con apellidos+nombres poblados → UI muestra ensamblado", () => {
    const payload = { nombre: "DIAZ GARCIA MARGARITA IBETH", apellidos: "DIAZ GARCIA", nombres: "MARGARITA IBETH" };
    const uiValue = ensamblarNombreNotarial(payload);
    expect(uiValue).toBe("MARGARITA IBETH DIAZ GARCIA");
  });

  it("B. Hidratación sin separados (legacy) → UI cae al verbatim", () => {
    const payload = { nombre: "JUAN PEREZ" };
    const uiValue = ensamblarNombreNotarial(payload);
    expect(uiValue).toBe("JUAN PEREZ");
  });

  it("C. Paridad UI↔backend: para cualquier payload persistido, UI == minuta", () => {
    const cases = [
      { nombre: "DIAZ GARCIA MARGARITA IBETH", apellidos: "DIAZ GARCIA", nombres: "MARGARITA IBETH" },
      { nombre: "PEREZ LOPEZ JUAN CARLOS", apellidos: "PEREZ LOPEZ", nombres: "JUAN CARLOS" },
      { nombre: "DE LA CRUZ MARIA JOSE", apellidos: "DE LA CRUZ", nombres: "MARIA JOSE" },
      { nombre: "JUAN PEREZ" }, // legacy sin separados
      { nombre: "PEREZ LOPEZ JUAN", apellidos: "PEREZ LOPEZ" }, // sólo apellidos → fallback
      {}, // vacío total
    ];
    for (const payload of cases) {
      expect(ensamblarNombreNotarial(payload)).toBe(nombreImpresoEnMinuta(payload));
    }
  });

  it("D. Edición manual (nombres/apellidos undefined) → helper devuelve verbatim editado", () => {
    // Cuando el humano edita el input, `updateAt` invalida apellidos/nombres a
    // undefined y persiste sólo `nombre`. El helper cae al verbatim → el
    // backend imprime exactamente lo que el usuario tipeó.
    const payload = { nombre: "JUAN PEREZ ROJAS", apellidos: undefined, nombres: undefined };
    expect(ensamblarNombreNotarial(payload)).toBe("JUAN PEREZ ROJAS");
  });
});
