import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Variable, Check, X } from "lucide-react";

interface SelectionToolbarProps {
  selectedText: string;
  position: { top: number; left: number };
  onCreateVariable: (variableName: string) => void;
  onClose: () => void;
}

const SelectionToolbar = ({ selectedText, position, onCreateVariable, onClose }: SelectionToolbarProps) => {
  const [showNameInput, setShowNameInput] = useState(false);
  const [varName, setVarName] = useState("");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNameInput) inputRef.current?.focus();
  }, [showNameInput]);

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

  const handleConfirm = () => {
    const name = varName.trim().replace(/\s+/g, "_").toLowerCase();
    if (name) {
      onCreateVariable(name);
    }
  };

  return (
    <div
      ref={toolbarRef}
      className="fixed z-[100] rounded-lg border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ top: position.top, left: position.left }}
    >
      {!showNameInput ? (
        <div className="p-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setShowNameInput(true)}
          >
            <Variable className="h-3.5 w-3.5" />
            Convertir en variable
          </Button>
        </div>
      ) : (
        <div className="p-3 w-72 space-y-2">
          <Label className="text-xs text-muted-foreground">
            Texto: <span className="font-medium text-foreground">"{selectedText.slice(0, 40)}{selectedText.length > 40 ? "…" : ""}"</span>
          </Label>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={varName}
              onChange={(e) => setVarName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              className="h-8 text-sm"
              placeholder="nombre_variable"
            />
            <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleConfirm} disabled={!varName.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SelectionToolbar;
