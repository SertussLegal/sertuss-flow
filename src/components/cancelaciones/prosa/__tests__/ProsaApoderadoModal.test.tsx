// ============================================================================
// ProsaApoderadoModal — tests de regresión para el punto de decisión IA
// (pendingSuggestion) y para el orden de cierre en handleSave.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// jsdom no incluye ResizeObserver (usado por Radix ScrollArea).
class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverPolyfill }).ResizeObserver ??= ResizeObserverPolyfill;


// ---- Mocks ----

const invokeMock = vi.fn();
const updateMock = vi.fn();
const eqMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
    from: () => ({
      update: (payload: unknown) => {
        updateMock(payload);
        return { eq: (col: string, val: string) => eqMock(col, val) };
      },
    }),
  },
}));

// Sonner: capturar orden de llamadas
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
  },
}));

// El renderer real llama a `daviviendaTemplate.renderComparecencia`; para los
// tests sólo necesitamos que refleje las `notas_adicionales` del override.
vi.mock("../ProsaLiveRenderer", () => ({
  ProsaLiveRenderer: ({ override, section }: { override?: { notas_adicionales?: string | null }; section?: string }) => (
    <div data-testid={`prosa-live-${section ?? "comparecencia"}`}>
      NOTAS:{override?.notas_adicionales ?? ""}
    </div>
  ),
}));

import { ProsaApoderadoModal } from "../ProsaApoderadoModal";
import type { ProsaContext } from "@shared/prosaBancos/types";

// ---- Fixtures ----

const baseContext: ProsaContext = {
  apoderado: { tipo: "juridica", nombre: "APODERADO S.A.", sociedad_nit: "900.000.000-1" },
  poderdante: {
    entidad_nombre: "BANCO DAVIVIENDA S.A.",
    entidad_nit: "860.034.313-7",
    representante_legal_nombre: "Rep Legal",
  },
  instrumento: {},
  ciudad_firma: "Bogotá D.C.",
};

const CANONICAL_PASTED = "COMPARECIÓ: alguien... PRIMERO.- otorga poder...";

const renderModal = (extra: Partial<React.ComponentProps<typeof ProsaApoderadoModal>> = {}) => {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <ProsaApoderadoModal
      open={true}
      onOpenChange={onOpenChange}
      cancelacionId="cancel-1"
      baseContext={baseContext}
      currentOverride={null}
      onSaved={onSaved}
      {...extra}
    />,
  );
  return { ...utils, onOpenChange, onSaved };
};

// Simula el guardado exitoso: update().eq() devuelve { error: null }
const arrangeUpdateOk = () => {
  updateMock.mockReset();
  eqMock.mockReset();
  eqMock.mockResolvedValue({ error: null });
};

// Llega hasta el bloque de decisión pegando canónico + click en "Guardar" +
// click en "Usar como referencia de estilo". Devuelve el user event handle.
const arriveAtPendingSuggestion = async (opts?: { suggestion?: string }) => {
  const suggestion = opts?.suggestion ?? "Sugerencia IA formal";
  arrangeUpdateOk();
  const utils = renderModal();
  const user = userEvent.setup();
  const textarea = screen.getByPlaceholderText(/El otorgamiento se realiza/i);
  await user.click(textarea);
  await user.paste(CANONICAL_PASTED);
  await user.click(screen.getByRole("button", { name: /Guardar y cerrar/i }));
  // Banda de rescate visible
  const rescueBtn = await screen.findByRole("button", { name: /Usar como referencia de estilo/i });
  invokeMock.mockResolvedValueOnce({ data: { notas_sugeridas: suggestion }, error: null });
  await user.click(rescueBtn);
  await screen.findByText(/Sugerencia de la IA/i);
  return { ...utils, user, suggestion };
};

beforeEach(() => {
  invokeMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastInfo.mockReset();
  arrangeUpdateOk();
});

// ---- Tests ----

describe("ProsaApoderadoModal — punto de decisión IA", () => {
  it("(1) rescate: aparece pendingSuggestion sin tocar `notas`, Guardar deshabilitado", async () => {
    const { suggestion } = await arriveAtPendingSuggestion({ suggestion: "Propuesta A" });
    // Textarea conserva el texto original pegado
    const textarea = screen.getByPlaceholderText(/El otorgamiento se realiza/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe(CANONICAL_PASTED);
    // Bloque de sugerencia visible con la propuesta
    expect(screen.getByText(suggestion)).toBeInTheDocument();
    // Preview refleja la sugerencia (no el texto pegado)
    expect(screen.getByTestId("prosa-live-comparecencia")).toHaveTextContent(`NOTAS:${suggestion}`);
    // Guardar deshabilitado
    const saveBtn = screen.getByRole("button", { name: /Guardar y cerrar/i });
    expect(saveBtn).toBeDisabled();
    expect(screen.getByText(/Decide qué hacer con la sugerencia/i)).toBeInTheDocument();
  });

  it("(2) Aplicar mueve la sugerencia al textarea y habilita Guardar", async () => {
    const { user, suggestion } = await arriveAtPendingSuggestion({ suggestion: "Estilo formal aplicable" });
    await user.click(screen.getByRole("button", { name: /^Aplicar$/i }));
    const textarea = screen.getByPlaceholderText(/El otorgamiento se realiza/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe(suggestion);
    // Bloque de sugerencia desaparece
    expect(screen.queryByText(/Sugerencia de la IA/i)).not.toBeInTheDocument();
    // Guardar habilitado (la nota propuesta es válida)
    expect(screen.getByRole("button", { name: /Guardar y cerrar/i })).not.toBeDisabled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("(3) Descartar conserva el texto original pegado y limpia la sugerencia", async () => {
    const { user } = await arriveAtPendingSuggestion();
    await user.click(screen.getByRole("button", { name: /Descartar/i }));
    const textarea = screen.getByPlaceholderText(/El otorgamiento se realiza/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe(CANONICAL_PASTED);
    expect(screen.queryByText(/Sugerencia de la IA/i)).not.toBeInTheDocument();
    // Guardar sigue deshabilitado por longitud? No: sólo se bloquea por
    // pendingSuggestion o exceso. Aquí el bloqueo real es que al guardar
    // Zod rechaza (marcador canónico) — pero eso pasa en `handleSave`.
    // El botón visualmente vuelve a habilitarse.
    expect(screen.getByRole("button", { name: /Guardar y cerrar/i })).not.toBeDisabled();
  });

  it("(4) Reintentar concatena el comentario al rawText original", async () => {
    const { user } = await arriveAtPendingSuggestion({ suggestion: "Primera propuesta" });
    invokeMock.mockResolvedValueOnce({ data: { notas_sugeridas: "Segunda propuesta más formal" }, error: null });
    const retryInput = screen.getByPlaceholderText(/más formal, menciona/i);
    await user.type(retryInput, "hazlo más formal");
    await user.click(screen.getByRole("button", { name: /Reintentar/i }));
    await waitFor(() => expect(screen.getAllByText(/Segunda propuesta más formal/).length).toBeGreaterThan(0));
    const lastCall = invokeMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("adaptar-estilo-prosa");
    const body = (lastCall?.[1] as { body: { rawText: string } }).body;
    expect(body.rawText).toContain(CANONICAL_PASTED);
    expect(body.rawText).toContain("Ajuste solicitado por el usuario: hazlo más formal");
    // Comentario se limpia
    expect((screen.getByPlaceholderText(/más formal, menciona/i) as HTMLInputElement).value).toBe("");
  });

  it("(5) Reintento devuelve vacío: conserva la propuesta previa, muestra toast.info", async () => {
    const { user } = await arriveAtPendingSuggestion({ suggestion: "Propuesta A" });
    invokeMock.mockResolvedValueOnce({ data: { notas_sugeridas: "" }, error: null });
    await user.type(screen.getByPlaceholderText(/más formal, menciona/i), "algo");
    await user.click(screen.getByRole("button", { name: /Reintentar/i }));
    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    // Propuesta previa sigue visible
    expect(screen.getByText("Propuesta A")).toBeInTheDocument();
  });

  it("(6a) Cerrar con pendingSuggestion + confirm=false → NO cierra", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user, onOpenChange } = await arriveAtPendingSuggestion();
    await user.click(screen.getByRole("button", { name: /^Cancelar$/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Sugerencia de la IA/i)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("(6b) Cerrar con pendingSuggestion + confirm=true → cierra y limpia", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, onOpenChange } = await arriveAtPendingSuggestion();
    await user.click(screen.getByRole("button", { name: /^Cancelar$/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    confirmSpy.mockRestore();
  });
});

describe("ProsaApoderadoModal — orden de cierre en handleSave", () => {
  it("(7) camino feliz: onOpenChange(false) → onSaved → toast.success", async () => {
    arrangeUpdateOk();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <ProsaApoderadoModal
        open={true}
        onOpenChange={onOpenChange}
        cancelacionId="cancel-1"
        baseContext={baseContext}
        currentOverride={null}
        onSaved={onSaved}
      />,
    );
    const user = userEvent.setup();
    const textarea = screen.getByPlaceholderText(/El otorgamiento se realiza/i);
    await user.type(textarea, "una nota corta y válida");
    await user.click(screen.getByRole("button", { name: /Guardar y cerrar/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    const closeOrder = onOpenChange.mock.invocationCallOrder[0];
    const savedOrder = onSaved.mock.invocationCallOrder[0];
    const toastOrder = toastSuccess.mock.invocationCallOrder[0];
    expect(closeOrder).toBeLessThan(savedOrder);
    expect(savedOrder).toBeLessThan(toastOrder);
  });
});
