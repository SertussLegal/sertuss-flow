import * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SegmentedChoiceOption<T extends string> = {
  value: T;
  label: string;
};

interface SegmentedChoiceProps<T extends string> {
  label?: string;
  options: SegmentedChoiceOption<T>[];
  value: T | "";
  onChange: (v: T | "") => void;
  helper?: React.ReactNode;
  size?: "sm" | "md";
  ariaLabel?: string;
  className?: string;
}

/**
 * Control segmentado reutilizable para selecciones binarias/ternarias.
 * Visualmente diferenciado como botón: contenedor con borde, segmento activo
 * elevado (bg-background + shadow), inactivos en muted. Patrón estilo iOS.
 *
 * Usado en flujos notariales para género gramatical, tratamiento de entidad, etc.
 */
export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  helper,
  size = "sm",
  ariaLabel,
  className,
}: SegmentedChoiceProps<T>) {
  const itemHeight = size === "md" ? "h-9 px-4 text-sm" : "h-8 px-3 text-xs";

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </Label>
      )}
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => onChange((v as T) || "")}
        aria-label={ariaLabel ?? label}
        className="inline-flex w-auto items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 shadow-sm"
      >
        {options.map((opt) => (
          <ToggleGroupItem
            key={opt.value}
            value={opt.value}
            aria-label={opt.label}
            className={cn(
              itemHeight,
              "rounded-md font-medium text-muted-foreground transition-all",
              "hover:bg-background/60 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm data-[state=on]:border data-[state=on]:border-border",
            )}
          >
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {helper && (
        <p className="text-[10px] leading-snug text-muted-foreground">{helper}</p>
      )}
    </div>
  );
}
