import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScanLine, Check, X } from "lucide-react";

interface OcrSuggestionProps {
  value: string;
  onConfirm: () => void;
  onIgnore: () => void;
  children: React.ReactNode;
}

const OcrSuggestion = ({ value, onConfirm, onIgnore, children }: OcrSuggestionProps) => (
  <Popover open>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent side="top" className="w-auto max-w-xs p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ScanLine className="h-3.5 w-3.5" />
          Valor detectado por OCR
        </div>
        <p className="text-sm font-medium break-all">{value}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="default" className="h-7 text-xs" onClick={onConfirm}>
            <Check className="mr-1 h-3 w-3" /> Confirmar
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onIgnore}>
            <X className="mr-1 h-3 w-3" /> Ignorar
          </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
);

export default OcrSuggestion;
