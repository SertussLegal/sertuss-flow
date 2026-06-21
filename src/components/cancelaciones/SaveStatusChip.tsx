import { CheckCircle2, Clock, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SaveStatusChipProps {
  isDirty: boolean;
  saving: boolean;
  previewRefreshing: boolean;
  lastError: string | null;
  onRetry: () => void;
}

/**
 * Indicador vivo del ciclo de autoguardado en Cancelaciones.
 * Reemplaza al botón manual "Guardar cambios". Estados:
 *  - Rojo (error)         → "No se pudo guardar — Reintentar"
 *  - Azul (saving)        → "Guardando…"
 *  - Ámbar (dirty)        → "Cambios pendientes…"
 *  - Verde (sincronizado) → "Documento actualizado"
 */
export function SaveStatusChip({
  isDirty,
  saving,
  previewRefreshing,
  lastError,
  onRetry,
}: SaveStatusChipProps) {
  // Prioridad: error > saving > dirty > sincronizado.
  if (lastError) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive"
        title={lastError}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        <span>No se pudo guardar</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRetry}
          className="h-5 px-1.5 text-xs font-medium text-destructive hover:bg-destructive/15 hover:text-destructive"
        >
          Reintentar
        </Button>
      </div>
    );
  }

  if (saving || previewRefreshing) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs text-sky-600 dark:text-sky-300"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Guardando…</span>
      </div>
    );
  }

  if (isDirty) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300"
      >
        <Clock className="h-3.5 w-3.5" />
        <span>Cambios pendientes…</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300"
    >
      <CheckCircle2 className="h-3.5 w-3.5" />
      <span>Documento actualizado</span>
    </div>
  );
}

export default SaveStatusChip;
