import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks ---
const mockRows: Array<Record<string, unknown>> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => Promise.resolve({ data: mockRows, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

import Cancelaciones from "./Cancelaciones";

const setRows = (rows: Array<Record<string, unknown>>) => {
  mockRows.length = 0;
  mockRows.push(...rows);
};

const renderPage = async (waitForText: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Cancelaciones />
      </MemoryRouter>
    </QueryClientProvider>
  );
  await screen.findByText(waitForText);
  return utils;
};

const baseRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: crypto.randomUUID(),
  matricula_inmobiliaria: "050C-12345",
  deudor_nombre: "Juan Pérez",
  deudor_cedula: "1234567890",
  status: "draft",
  revision_manual_requerida: false,
  created_at: new Date().toISOString(),
  ...overrides,
});

describe("Cancelaciones — visibilidad de revision_manual_requerida", () => {
  beforeEach(() => {
    setRows([]);
  });

  it("muestra chip 'Revisión manual' junto a badge 'Completada' cuando flag=true y status=completed", async () => {
    setRows([
      baseRow({
        matricula_inmobiliaria: "MAT-9dc33048",
        status: "completed",
        revision_manual_requerida: true,
      }),
    ]);
    await renderPage("MAT-9dc33048");

    const row = screen.getByText("MAT-9dc33048").closest("tr")!;
    expect(within(row).getByText("Completada")).toBeInTheDocument();
    expect(within(row).getByText("Con alertas")).toBeInTheDocument();
  });

  it("status='requiere_revision_manual' pinta badge rojo distintivo, no fallback 'Borrador'", async () => {
    setRows([
      baseRow({
        matricula_inmobiliaria: "MAT-BLOCK",
        status: "requiere_revision_manual",
        revision_manual_requerida: true,
      }),
    ]);
    await renderPage("MAT-BLOCK");

    const row = screen.getByText("MAT-BLOCK").closest("tr")!;
    expect(within(row).getByText("Bloqueada")).toBeInTheDocument();
    expect(within(row).queryByText("Borrador")).not.toBeInTheDocument();
  });

  it("tab 'Requieren revisión' filtra sólo filas con flag o status bloqueante", async () => {
    setRows([
      baseRow({ matricula_inmobiliaria: "FLAG-ON", status: "completed", revision_manual_requerida: true }),
      baseRow({ matricula_inmobiliaria: "BLOCK-STATUS", status: "requiere_revision_manual", revision_manual_requerida: false }),
      baseRow({ matricula_inmobiliaria: "CLEAN-DONE", status: "completed", revision_manual_requerida: false }),
      baseRow({ matricula_inmobiliaria: "CLEAN-DRAFT", status: "draft", revision_manual_requerida: false }),
    ]);
    await renderPage("FLAG-ON");

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Requieren revisión/i }));

    expect(screen.getByText("FLAG-ON")).toBeInTheDocument();
    expect(screen.getByText("BLOCK-STATUS")).toBeInTheDocument();
    expect(screen.queryByText("CLEAN-DONE")).not.toBeInTheDocument();
    expect(screen.queryByText("CLEAN-DRAFT")).not.toBeInTheDocument();
  });

  it("estados existentes sin flag renderizan su badge original", async () => {
    setRows([
      baseRow({ matricula_inmobiliaria: "R-DRAFT", status: "draft" }),
      baseRow({ matricula_inmobiliaria: "R-PROC", status: "processing" }),
      baseRow({ matricula_inmobiliaria: "R-DONE", status: "completed" }),
      baseRow({ matricula_inmobiliaria: "R-ERR", status: "error" }),
    ]);
    await renderPage("R-DRAFT");

    expect(within(screen.getByText("R-DRAFT").closest("tr")!).getByText("Borrador")).toBeInTheDocument();
    expect(within(screen.getByText("R-PROC").closest("tr")!).getByText("Procesando")).toBeInTheDocument();
    expect(within(screen.getByText("R-DONE").closest("tr")!).getByText("Completada")).toBeInTheDocument();
    expect(within(screen.getByText("R-ERR").closest("tr")!).getByText("Error")).toBeInTheDocument();

    expect(screen.queryByText("Revisión manual")).not.toBeInTheDocument();
    expect(screen.queryByText("Revisión manual bloqueante")).not.toBeInTheDocument();
  });

  it("cuenta con filas pero filtro vacío muestra mensaje de filtro, no mensaje de cuenta vacía", async () => {
    setRows([
      baseRow({ matricula_inmobiliaria: "CLEAN-DONE", status: "completed", revision_manual_requerida: false }),
    ]);
    await renderPage("CLEAN-DONE");

    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /Requieren revisión/i }));

    expect(screen.queryByText("CLEAN-DONE")).not.toBeInTheDocument();
    expect(screen.getByText("No hay cancelaciones que coincidan con este filtro")).toBeInTheDocument();
    expect(screen.queryByText("No hay cancelaciones registradas aún")).not.toBeInTheDocument();
  });
});
