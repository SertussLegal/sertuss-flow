import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, X, Replace } from "lucide-react";
import { toast } from "sonner";

interface InlineEditToolbarProps {
  selectedText: string;
  position: { top: number; left: number };
  occurrenceCount: number;
  onApply: (newText: string, replaceAll: boolean) => void;
  onClose: () => void;
}

const InlineEditToolbar = ({
  selectedText,
  position,
  occurrenceCount,
  onApply,
  onClose,
}: InlineEditToolbarProps) => {
  const [newText, setNewText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const handleApply = useCallback(
    (replaceAll: boolean) => {
      if (!newText.trim()) {
        toast.error("Escribe el texto de reemplazo");
        return;
      }
      if (/\{[^}]+\}/.test(selectedText)) {
        toast.error("Edita variables de plantilla desde el formulario");
        onClose();
        return;
      }
      if (selectedText.length > 300) {
        toast.error("Selección muy larga (máx. 300 caracteres)");
        onClose();
        return;
      }
      onApply(newText.trim(), replaceAll);
    },
    [newText, selectedText, onApply, onClose]
  );

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

      {/* Input */}
      <div className="flex gap-2 mb-2">
        <Input
          ref={inputRef}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleApply(occurrenceCount <= 1);
          }}
          className="h-8 text-sm"
          placeholder="Nuevo texto…"
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Action buttons */}
      {occurrenceCount > 1 ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            className="h-7 text-xs flex-1"
            onClick={() => handleApply(false)}
            disabled={!newText.trim()}
          >
            <Check className="h-3 w-3 mr-1" /> Solo esta
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs flex-1"
            onClick={() => handleApply(true)}
            disabled={!newText.trim()}
          >
            <Replace className="h-3 w-3 mr-1" /> Todas ({occurrenceCount})
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
