import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Variable, Check, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SelectionToolbarProps {
  selectedText: string;
  position: { top: number; left: number };
  existingVariables?: string[];
  onCreateVariable: (variableName: string) => void;
  onClose: () => void;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

const SelectionToolbar = ({ selectedText, position, existingVariables = [], onCreateVariable, onClose }: SelectionToolbarProps) => {
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

  const normalizedInput = varName.trim().replace(/\s+/g, "_").toLowerCase();

  const suggestions = useMemo(() => {
    if (!normalizedInput) return [];
    return existingVariables.filter(v =>
      v.toLowerCase().includes(normalizedInput)
    ).slice(0, 5);
  }, [normalizedInput, existingVariables]);

  const isExactMatch = suggestions.some(s => s.toLowerCase() === normalizedInput);

  const handleConfirm = () => {
    if (normalizedInput) {
      onCreateVariable(normalizedInput);
    }
  };

  const handleSelectSuggestion = (name: string) => {
    onCreateVariable(name);
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
        <div className="p-3 w-80 space-y-2">
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

          {/* Suggestions */}
          {normalizedInput && (suggestions.length > 0 || !isExactMatch) && (
            <div className="border rounded-md overflow-hidden">
              {suggestions.length > 0 && (
                <ScrollArea className="max-h-32">
                  <div className="p-1 space-y-0.5">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent text-left transition-colors"
                        onClick={() => handleSelectSuggestion(s)}
                      >
                        <span className="font-mono truncate text-foreground">{s}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0 px-1.5 py-0">
                          existente
                        </Badge>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}
              {!isExactMatch && normalizedInput && (
                <>
                  {suggestions.length > 0 && (
                    <div className="border-t px-2 py-1">
                      <span className="text-[10px] text-muted-foreground">o crear nueva</span>
                    </div>
                  )}
                  <button
                    className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent text-left transition-colors"
                    onClick={handleConfirm}
                  >
                    <span className="font-mono truncate text-foreground">{normalizedInput}</span>
                    <Badge className="text-[10px] shrink-0 px-1.5 py-0">
                      nueva
                    </Badge>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SelectionToolbar;
