import { Link } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Forbidden403Props {
  moduleName?: string;
}

export const Forbidden403 = ({ moduleName }: Forbidden403Props) => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
      <ShieldOff className="h-8 w-8 text-muted-foreground" />
    </div>
    <h1 className="text-xl font-semibold">Módulo no disponible</h1>
    <p className="max-w-md text-sm text-muted-foreground">
      {moduleName
        ? `El módulo "${moduleName}" no está activo para tu organización.`
        : "Este módulo no está activo para tu organización."}{" "}
      Contacta al administrador del sistema si necesitas habilitarlo.
    </p>
    <Button asChild variant="outline">
      <Link to="/escrituras">Volver</Link>
    </Button>
  </div>
);
