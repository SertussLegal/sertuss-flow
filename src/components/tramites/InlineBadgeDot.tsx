import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Nivel = "error" | "advertencia" | "sugerencia";

interface InlineBadgeDotProps {
  explicacion: string;
  nivel?: Nivel;
  className?: string;
}

const COLOR_BG: Record<Nivel | "default", string> = {
  error: "bg-destructive",
  advertencia: "bg-accent",
  sugerencia: "bg-primary/70",
  default: "bg-accent",
};

const COLOR_RING: Record<Nivel | "default", string> = {
  error: "ring-destructive/30",
  advertencia: "ring-accent/30",
  sugerencia: "ring-primary/30",
  default: "ring-accent/30",
};

const truncate = (text: string, max = 180) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

export const InlineBadgeDot = ({ explicacion, nivel, className }: InlineBadgeDotProps) => {
  const key: Nivel | "default" = nivel ?? "default";
  const [pulsing, setPulsing] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setPulsing(false), 3000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`Validación: ${truncate(explicacion, 80)}`}
          className={cn("inline-flex items-center justify-center align-middle outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full", className)}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              COLOR_BG[key],
              pulsing
                ? "animate-pulse"
                : cn("ring-2 ring-offset-1 ring-offset-background", COLOR_RING[key]),
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-snug">
        {truncate(explicacion)}
      </TooltipContent>
    </Tooltip>
  );
};

export default InlineBadgeDot;
