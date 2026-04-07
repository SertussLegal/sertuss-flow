import { FileText, CheckCircle, Clock, AlertTriangle, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useRef, useCallback } from "react";

export interface ExpedienteDoc {
  tipo: string;
  label: string;
  status: "procesado" | "pendiente" | "error";
  nombre?: string;
  timestamp?: string;
}

interface ExpedienteSidebarProps {
  documentos: ExpedienteDoc[];
  onUploadDocument?: (tipo: string, file: File) => void;
  uploading?: string | null;
}

const statusConfig = {
  procesado: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/20", badge: "default" as const, label: "Procesado" },
  pendiente: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/20", badge: "secondary" as const, label: "Pendiente" },
  error: { icon: AlertTriangle, color: "text-destructive", bg: "bg-red-50 dark:bg-red-950/20", badge: "destructive" as const, label: "Error" },
};

const ExpedienteSidebar = ({ documentos, onUploadDocument, uploading }: ExpedienteSidebarProps) => {
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleFileChange = useCallback((tipo: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadDocument) {
      onUploadDocument(tipo, file);
    }
    e.target.value = "";
  }, [onUploadDocument]);

  const procesados = documentos.filter(d => d.status === "procesado").length;
  const total = documentos.length;

  return (
    <div className="h-full flex flex-col bg-muted/30">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Expediente del Trámite
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {procesados}/{total} documentos procesados
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {documentos.map((doc) => {
            const config = statusConfig[doc.status];
            const Icon = config.icon;
            const isUploading = uploading === doc.tipo;

            return (
              <div
                key={doc.tipo}
                className={`rounded-lg border p-3 ${config.bg} transition-colors`}
              >
                <div className="flex items-start gap-2">
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-tight">{doc.label}</p>
                    {doc.nombre && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {doc.nombre}
                      </p>
                    )}
                  </div>
                  <Badge variant={config.badge} className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                    {config.label}
                  </Badge>
                </div>

                {doc.status === "pendiente" && onUploadDocument && (
                  <div className="mt-2">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      ref={(el) => { fileRefs.current[doc.tipo] = el; }}
                      onChange={(e) => handleFileChange(doc.tipo, e)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs"
                      disabled={isUploading}
                      onClick={() => fileRefs.current[doc.tipo]?.click()}
                    >
                      {isUploading ? (
                        <><Clock className="mr-1 h-3 w-3 animate-spin" /> Procesando...</>
                      ) : (
                        <><Upload className="mr-1 h-3 w-3" /> Subir documento</>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ExpedienteSidebar;
