import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | null;

interface SaveStatusContextValue {
  status: SaveStatus;
  setStatus: (status: SaveStatus) => void;
  /**
   * Muestra el chip "Guardado" durante `ms` (default 2000) y luego
   * regresa a `null`. Útil tras autosaves silenciosos para dar
   * confirmación pasiva sin spam de toasts.
   */
  flashSaved: (ms?: number) => void;
}

const SaveStatusContext = createContext<SaveStatusContextValue | undefined>(undefined);

export const SaveStatusProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatusState] = useState<SaveStatus>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const setStatus = useCallback((s: SaveStatus) => {
    clearTimer();
    setStatusState(s);
  }, []);

  const flashSaved = useCallback((ms = 2000) => {
    clearTimer();
    setStatusState("saved");
    timerRef.current = window.setTimeout(() => {
      setStatusState(null);
      timerRef.current = null;
    }, ms);
  }, []);

  useEffect(() => clearTimer, []);

  const value = useMemo(() => ({ status, setStatus, flashSaved }), [status, setStatus, flashSaved]);
  return <SaveStatusContext.Provider value={value}>{children}</SaveStatusContext.Provider>;
};

export const useSaveStatus = () => {
  const ctx = useContext(SaveStatusContext);
  if (!ctx) {
    return {
      status: null as SaveStatus,
      setStatus: (_: SaveStatus) => {},
      flashSaved: (_?: number) => {},
    };
  }
  return ctx;
};
