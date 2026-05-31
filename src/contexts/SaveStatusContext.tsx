import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | null;

interface SaveStatusContextValue {
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
}

const SaveStatusContext = createContext<SaveStatusContextValue | undefined>(undefined);

export const SaveStatusProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatusState] = useState<SaveStatus>(null);
  const setStatus = useCallback((s: SaveStatus) => setStatusState(s), []);
  const value = useMemo(() => ({ status, setStatus }), [status, setStatus]);
  return <SaveStatusContext.Provider value={value}>{children}</SaveStatusContext.Provider>;
};

export const useSaveStatus = () => {
  const ctx = useContext(SaveStatusContext);
  if (!ctx) {
    // Permitir uso fuera del provider sin romper (no-op)
    return { status: null as SaveStatus, setStatus: (_: SaveStatus) => {} };
  }
  return ctx;
};
