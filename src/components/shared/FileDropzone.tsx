import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FileDropzoneProps = {
  label?: string;
  file: File | null;
  onFile: (file: File | null) => void;
  /** MIME accept string. Defaults to "application/pdf". */
  accept?: string;
  /** Hint shown under the prompt (e.g. "Solo archivos .pdf"). */
  hint?: string;
  /** Override the main prompt copy. */
  prompt?: string;
  className?: string;
  disabled?: boolean;
};

const DEFAULT_PROMPT = "Arrastra el PDF aquí o haz clic para seleccionar";
const DEFAULT_HINT = "Solo archivos .pdf";

export const FileDropzone = ({
  label,
  file,
  onFile,
  accept = "application/pdf",
  hint = DEFAULT_HINT,
  prompt = DEFAULT_PROMPT,
  className,
  disabled = false,
}: FileDropzoneProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  const validate = useCallback(
    (f: File) => {
      if (!accept || accept === "*") return true;
      // Allow comma-separated MIME types or extensions
      const tokens = accept.split(",").map((t) => t.trim().toLowerCase());
      const mime = f.type.toLowerCase();
      const name = f.name.toLowerCase();
      const ok = tokens.some((t) =>
        t.startsWith(".") ? name.endsWith(t) : mime === t || (t.endsWith("/*") && mime.startsWith(t.slice(0, -1))),
      );
      if (!ok) {
        toast.error("Tipo de archivo no permitido", {
          description: `Se esperaba: ${accept}`,
        });
      }
      return ok;
    },
    [accept],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      if (!validate(f)) return;
      onFile(f);
    },
    [onFile, validate],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label ? <Label className="text-sm font-medium">{label}</Label> : null}

      {file ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onFile(null)}
            disabled={disabled}
            aria-label="Quitar archivo"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={() => !disabled && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors",
            disabled && "cursor-not-allowed opacity-60",
            !disabled && "cursor-pointer",
            hover
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/60 hover:bg-muted/40",
          )}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium">{prompt}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
};
