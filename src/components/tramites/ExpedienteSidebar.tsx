import { FileText, CheckCircle, Clock, AlertTriangle, Upload, RefreshCw, Trash2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useRef, useCallback, useState } from "react";

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
  onReplaceDocument?: (tipo: string, file: File) => void;
  onDeleteDocument?: (tipo: string) => void;
  onAddCedula?: (file: File) => void;
  onToggleChange?: (toggle: string, value: boolean) => void;
  toggles?: { tieneCredito: boolean; tieneApoderado: boolean };
  uploading?: string | null;
}

const statusConfig = {
  procesado: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/20", badge: "default" as const, label: "Procesado" },
  pendiente: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/20", badge: "secondary" as const, label: "Pendiente" },
  error: { icon: AlertTriangle, color: "text-destructive", bg: "bg-red-50 dark:bg-red-950/20", badge: "destructive" as const, label: "Error" },
};

const OBLIGATORIOS = ["certificado_tradicion", "predial", "escritura_antecedente"];
const OPCIONALES = ["carta_credito", "poder_notarial"];

const ExpedienteSidebar = ({
  documentos, onUploadDocument, onReplaceDocument, onDeleteDocument,
  onAddCedula, onToggleChange, toggles, uploading,
}: ExpedienteSidebarProps) => {
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const replaceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const addCedulaRef = useRef<HTMLInputElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleFileChange = useCallback((tipo: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadDocument) onUploadDocument(tipo, file);
    e.target.value = "";
  }, [onUploadDocument]);

  const handleReplaceChange = useCallback((tipo: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onReplaceDocument) onReplaceDocument(tipo, file);
    e.target.value = "";
  }, [onReplaceDocument]);

  const handleAddCedulaChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onAddCedula) onAddCedula(file);
    e.target.value = "";
  }, [onAddCedula]);

  const obligatorios = documentos.filter(d => OBLIGATORIOS.includes(d.tipo));
  const cedulas = documentos.filter(d => d.tipo.startsWith("cedula_"));
  const opcionales = documentos.filter(d => OPCIONALES.includes(d.tipo));

  const procesados = documentos.filter(d => d.status === "procesado").length;
  const total = documentos.length;

  const deleteDoc = documentos.find(d => d.tipo === deleteTarget);

  const renderDocCard = (doc: ExpedienteDoc) => {
    const config = statusConfig[doc.status];
    const Icon = config.icon;
    const isUploading = uploading === doc.tipo;

    return (
      <div key={doc.tipo} className={`rounded-lg border p-3 ${config.bg} transition-colors`}>
        <div className="flex items-start gap-2">
          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium leading-tight">{doc.label}</p>
            {doc.nombre && (
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">{doc.nombre}</p>
            )}
          </div>
          <Badge variant={config.badge} className="text-[10px] px-1.5 py-0 h-4 shrink-0">
            {config.label}
          </Badge>
        </div>

        {/* Actions for processed docs */}
        {doc.status === "procesado" && (onReplaceDocument || onDeleteDocument) && (
          <div className="mt-2 flex gap-1.5">
            {onReplaceDocument && (
              <>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  ref={(el) => { replaceRefs.current[doc.tipo] = el; }}
                  onChange={(e) => handleReplaceChange(doc.tipo, e)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs flex-1 gap-1"
                  disabled={isUploading}
                  onClick={() => replaceRefs.current[doc.tipo]?.click()}
                >
                  <RefreshCw className="h-3 w-3" /> Reemplazar
                </Button>
              </>
            )}
            {onDeleteDocument && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                onClick={() => setDeleteTarget(doc.tipo)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {/* Upload button for pending docs */}
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
  };

  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* Header */}
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
        <div className="p-3 space-y-4">
          {/* Section 1: Documentos Obligatorios */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Documentos Obligatorios
            </p>
            <div className="space-y-2">
              {obligatorios.map(renderDocCard)}
            </div>
          </div>

          <Separator />

          {/* Section 2: Cédulas de Identidad */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Cédulas de Identidad
            </p>
            <div className="space-y-2">
              {cedulas.map(renderDocCard)}
              {cedulas.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Sin cédulas cargadas</p>
              )}
            </div>
            {onAddCedula && (
              <div className="mt-2">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  ref={addCedulaRef}
                  onChange={handleAddCedulaChange}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs border-dashed gap-1"
                  onClick={() => addCedulaRef.current?.click()}
                  disabled={!!uploading}
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar Cédula
                </Button>
              </div>
            )}
          </div>

          <Separator />

          {/* Section 3: Documentos Opcionales */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Documentos Opcionales
            </p>
            <div className="space-y-3">
              {/* Toggle: Crédito Hipotecario */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium cursor-pointer" htmlFor="toggle-credito">
                    ¿Tiene Crédito Hipotecario?
                  </label>
                  <Switch
                    id="toggle-credito"
                    checked={toggles?.tieneCredito ?? false}
                    onCheckedChange={(v) => onToggleChange?.("tieneCredito", v)}
                  />
                </div>
                {toggles?.tieneCredito && opcionales.filter(d => d.tipo === "carta_credito").map(renderDocCard)}
              </div>

              {/* Toggle: Apoderado */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium cursor-pointer" htmlFor="toggle-apoderado">
                    ¿Tiene Apoderado?
                  </label>
                  <Switch
                    id="toggle-apoderado"
                    checked={toggles?.tieneApoderado ?? false}
                    onCheckedChange={(v) => onToggleChange?.("tieneApoderado", v)}
                  />
                </div>
                {toggles?.tieneApoderado && opcionales.filter(d => d.tipo === "poder_notarial").map(renderDocCard)}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrarán los datos extraídos de <strong>{deleteDoc?.label}</strong> en el formulario y el documento final. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget && onDeleteDocument) onDeleteDocument(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ExpedienteSidebar;
