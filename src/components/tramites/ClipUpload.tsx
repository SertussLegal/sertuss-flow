import { useRef, useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ClipUploadProps {
  fieldName: string;
  isEmpty: boolean;
  onFileSelected: (file: File) => void;
  loading?: boolean;
}

const ClipUpload = ({ fieldName, isEmpty, onFileSelected, loading }: ClipUploadProps) => {
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isEmpty) return null;

  return (
    <>
      <input
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        ref={fileRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelected(file);
          e.target.value = "";
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            onClick={() => fileRef.current?.click()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Paperclip className="h-3.5 w-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Subir documento para llenar este campo
        </TooltipContent>
      </Tooltip>
    </>
  );
};

export default ClipUpload;
