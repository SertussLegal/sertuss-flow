import { FileX } from "lucide-react";

const CancelacionesPlaceholder = () => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
      <FileX className="h-8 w-8 text-muted-foreground" />
    </div>
    <h1 className="text-xl font-semibold">Módulo de Cancelaciones</h1>
    <p className="max-w-md text-sm text-muted-foreground">
      Esta sección estará disponible próximamente.
    </p>
  </div>
);

export default CancelacionesPlaceholder;
