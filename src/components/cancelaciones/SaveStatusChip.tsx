import { CheckCircle2, Clock, Loader2, AlertCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SaveStatusChipProps {
  isDirty: boolean;
  saving: boolean;
  previewRefreshing: boolean;
  lastError: string | null;
  onRetry: () => void;
  /**
   * Cuando el row está en `requiere_revision_manual` el autosave no
   * puede regenerar (backend devuelve 409 hasta que el usuario confirme
   * la revisión). Mostramos un chip explícito en vez del ambiguo
   * "Guardando…" para que la usuaria sepa que debe pulsar el CTA del
   * banner y no espere a que se genere sola.
   */
  blocked?: boolean;
  /**
   * Cuando el .docx generado ya no refleja `data_final` (el usuario
   * editó pero aún no se regeneró la vista) el estado global NO está
   * "todo al día" aunque el formulario esté guardado. En ese caso el
   * chip se oculta y dejamos que el badge naranja "Vista desactualizada"
   * sea el único indicador de estado a la derecha de la barra.
   */
  previewStale?: boolean;
}

/**
 * Indicador vivo del ciclo de autoguardado en Cancelaciones.
 * Reemplaza al botón manual "Guardar cambios". Estados:
 *  - Ámbar bloqueo   → "Revisión manual pendiente"
 *  - Rojo (error)    → "No se pudo guardar — Reintentar"
 *  - Azul (saving)   → "Guardando…"
 *  - Ámbar (dirty)   → "Cambios pendientes…"
 *  - Verde (ok)      → "Guardado"
 *  - Oculto          → previewStale (el badge naranja externo manda)
 */
export function SaveStatusChip({
  isDirty,
  saving,
  previewRefreshing,
  lastError,
  onRetry,
  blocked,
  previewStale,
}: SaveStatusChipProps) {
  // Prioridad: bloqueo > error > saving > dirty > previewStale (oculto) > sincronizado.
  if (blocked && !saving) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300"
        title="El documento no se puede regenerar automáticamente hasta que confirmes la revisión manual desde el banner superior."
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        <span>Revisión manual pendiente</span>
      </div>
    );
  }

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
