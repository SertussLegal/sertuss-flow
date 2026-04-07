import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, X, Replace, ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { TextOverride } from "@/lib/types";

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface InlineEditToolbarProps {
  selectedText: string;
  position: { top: number; left: number };
  occurrenceCount: number;
  onApply: (newText: string, replaceAll: boolean) => void;
  onApplyAtIndex?: (newText: string, index: number) => void;
  onClose: () => void;
  onNavigate?: (index: number) => void;
  replacements?: Record<string, string>;
  existingOverrides?: TextOverride[];
}

const InlineEditToolbar = ({
  selectedText,
  position,
  occurrenceCount,
  onApply,
  onApplyAtIndex,
  onClose,
  onNavigate,
  replacements = {},
  existingOverrides = [],
}: InlineEditToolbarProps) => {
  const [newText, setNewText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [appliedIndices, setAppliedIndices] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const isAuditMode = occurrenceCount > 1;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Navigate to first occurrence on mount in audit mode
  useEffect(() => {
    if (isAuditMode && onNavigate) {
      onNavigate(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedIndices, occurrenceCount]);

  const handleClose = useCallback(() => {
    if (appliedIndices.size > 0 && appliedIndices.size < occurrenceCount) {
      toast.info(`${appliedIndices.size} de ${occurrenceCount} cambios aplicados`);
    }
    onClose();
  }, [appliedIndices, occurrenceCount, onClose]);

  const validate = useCallback((): boolean => {
    if (!newText.trim()) {
      toast.error("Escribe el texto de reemplazo");
      return false;
    }
    if (/\{[^}]+\}/.test(selectedText)) {
      toast.error("Edita variables de plantilla desde el formulario");
      onClose();
      return false;
    }
    if (selectedText.length > 300) {
      toast.error("Selección muy larga (máx. 300 caracteres)");
      onClose();
      return false;
    }
    return true;
  }, [newText, selectedText, onClose]);

  const handleApply = useCallback(
    (replaceAll: boolean) => {
      if (!validate()) return;
      onApply(newText.trim(), replaceAll);
    },
    [newText, validate, onApply]
  );

  const handleAcceptAndNext = useCallback(() => {
    if (!validate()) return;
    if (!onApplyAtIndex) {
      handleApply(false);
      return;
    }
    onApplyAtIndex(newText.trim(), currentIndex);
    const next = new Set(appliedIndices);
    next.add(currentIndex);
    setAppliedIndices(next);

    // Find next unapplied index
    let nextIdx = -1;
    for (let i = 1; i < occurrenceCount; i++) {
      const candidate = (currentIndex + i) % occurrenceCount;
      if (!next.has(candidate)) {
        nextIdx = candidate;
        break;
      }
    }

    if (nextIdx === -1) {
      toast.success("Auditoría completa");
      onClose();
    } else {
      setTimeout(() => {
        setCurrentIndex(nextIdx);
        onNavigate?.(nextIdx);
      }, 200);
    }
  }, [newText, validate, onApplyAtIndex, currentIndex, appliedIndices, occurrenceCount, onClose, onNavigate, handleApply]);

  const navigateTo = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(occurrenceCount - 1, idx));
    setCurrentIndex(clamped);
    onNavigate?.(clamped);
  }, [occurrenceCount, onNavigate]);

  // Smart suggestion chips with type-aware matching
  const chips = useMemo(() => {
    // Early return for decorative text
    if (!/[a-zA-Z0-9]/.test(selectedText)) return [];

    const result: { label: string; value: string; type: "official" | "override" | "format" }[] = [];
    const seen = new Set<string>();
    const lowerSelected = selectedText.toLowerCase().trim();
    const isNumeric = /^\d[\d.,]*$/.test(selectedText.trim());

    // Helper: calculate overlap ratio between two strings
    const overlapRatio = (a: string, b: string): number => {
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length > b.length ? a : b;
      if (longer.includes(shorter)) return shorter.length / longer.length;
      return 0;
    };

    // 1. Official data from replacements (type-aware)
    if (lowerSelected.length >= 3) {
      for (const [, val] of Object.entries(replacements)) {
        if (!val || /^[_.\-\s]+$/.test(val)) continue;
        const lowerVal = val.toLowerCase();
        const valIsNumeric = /^\d[\d.,]*$/.test(val.trim());

        // Type mismatch: skip numeric values for text selections and vice versa
        if (isNumeric !== valIsNumeric) continue;

        const ratio = overlapRatio(lowerSelected, lowerVal);
        if (ratio >= 0.4 && !seen.has(val) && val !== newText) {
          seen.add(val);
          result.push({ label: val.length > 30 ? val.slice(0, 28) + "…" : val, value: val, type: "official" });
        }
        if (result.length >= 3) break;
      }
    }

    // 2. Previous overrides with similar original text
    for (const ov of existingOverrides) {
      if (result.length >= 4) break;
      const lowerOv = ov.originalText.toLowerCase();
      const ratio = overlapRatio(lowerSelected, lowerOv);
      if (ratio >= 0.4 && ov.originalText.length >= 3) {
        if (!seen.has(ov.newText) && ov.newText !== newText) {
          seen.add(ov.newText);
          result.push({ label: ov.newText.length > 30 ? ov.newText.slice(0, 28) + "…" : ov.newText, value: ov.newText, type: "override" });
        }
      }
    }

    // 3. Smart case formatting (only when user has typed something)
    if (newText.trim().length > 0) {
      const upper = newText.trim().toUpperCase();
      const title = toTitleCase(newText.trim().toLowerCase());
      if (upper !== newText.trim() && !seen.has(upper)) {
        seen.add(upper);
        result.push({ label: upper.length > 30 ? upper.slice(0, 28) + "…" : upper, value: upper, type: "format" });
      }
      if (title !== newText.trim() && !seen.has(title)) {
        seen.add(title);
        result.push({ label: title.length > 30 ? title.slice(0, 28) + "…" : title, value: title, type: "format" });
      }
    }

    return result.slice(0, 5);
  }, [selectedText, newText, replacements, existingOverrides]);

  // Clamp position to viewport
  const clampedLeft = Math.min(Math.max(8, position.left), window.innerWidth - 340);
  const clampedTop = Math.min(position.top, window.innerHeight - 200);

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[100] w-80 rounded-lg border bg-popover p-3 shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ top: clampedTop, left: clampedLeft }}
    >
      {/* Original text */}
      <p className="text-xs text-muted-foreground mb-2 truncate">
        <span className="line-through opacity-70">
          "{selectedText.slice(0, 50)}{selectedText.length > 50 ? "…" : ""}"
        </span>
      </p>

      {/* Stepper - only in audit mode */}
      {isAuditMode && (
        <div className="flex items-center justify-center gap-2 mb-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => navigateTo(currentIndex - 1)}
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(occurrenceCount, 10) }, (_, i) => (
              <button
                key={i}
                onClick={() => navigateTo(i)}
                className={`h-2 w-2 rounded-full transition-all duration-200 ${
                  i === currentIndex
                    ? "ring-2 ring-primary ring-offset-1 ring-offset-popover bg-primary"
                    : appliedIndices.has(i)
                    ? "bg-green-500"
                    : "bg-muted-foreground/30"
                }`}
              />
            ))}
            {occurrenceCount > 10 && (
              <span className="text-[10px] text-muted-foreground ml-1">+{occurrenceCount - 10}</span>
            )}
          </div>

          <span className="text-xs font-medium text-muted-foreground min-w-[40px] text-center">
            {currentIndex + 1}/{occurrenceCount}
          </span>

          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => navigateTo(currentIndex + 1)}
            disabled={currentIndex === occurrenceCount - 1}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 mb-2">
        <Input
          ref={inputRef}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (isAuditMode) handleAcceptAndNext();
              else handleApply(false);
            }
          }}
          className="h-8 text-sm"
          placeholder="Nuevo texto…"
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={handleClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Smart suggestion chips */}
      {chips.length > 0 && (
        <div className="flex gap-1.5 mb-2 overflow-x-auto scrollbar-none">
          {chips.map((chip, i) => (
            <button
              key={i}
              onClick={() => setNewText(chip.value)}
              className={`text-[11px] rounded-full px-2 py-0.5 shrink-0 transition-all duration-200 animate-in fade-in-0 border ${
                chip.type === "official"
                  ? "bg-secondary/10 text-secondary border-secondary/20 hover:bg-secondary/20"
                  : chip.type === "override"
                  ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                  : "bg-muted/60 text-muted-foreground border-border hover:bg-muted"
              }`}
              title={chip.value}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {isAuditMode ? (
        <div className="space-y-1.5">
          {newText.trim() && (
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => handleApply(false)}
              >
                Cambiar esta
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={() => handleApply(true)}
              >
                <Replace className="h-3 w-3 mr-1" /> Cambiar todas ({occurrenceCount})
              </Button>
            </div>
          )}
          <Button
            size="sm"
            className="h-7 text-xs w-full"
            onClick={handleAcceptAndNext}
            disabled={!newText.trim()}
          >
            Aplicar y Siguiente <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          className="h-7 text-xs w-full"
          onClick={() => handleApply(false)}
          disabled={!newText.trim()}
        >
          <Check className="h-3 w-3 mr-1" /> Aplicar
        </Button>
      )}
    </div>
  );
};

export default InlineEditToolbar;
