import { FileText, CheckCircle, Clock, AlertTriangle, Upload, RefreshCw, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
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
  const progressPct = total > 0 ? Math.round((procesados / total) * 100) : 0;

  const deleteDoc = documentos.find(d => d.tipo === deleteTarget);

  const statusBorder = (status: string) => {
    if (status === "procesado") return "border-l-[3px] border-l-notarial-green";
    if (status === "pendiente") return "border-l-[3px] border-l-notarial-gold";
    return "border-l-[3px] border-l-destructive";
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === "procesado") return <CheckCircle className="h-3.5 w-3.5 text-notarial-green shrink-0" />;
    if (status === "pendiente") return <Clock className="h-3.5 w-3.5 text-notarial-gold shrink-0" />;
    return <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  };

  const renderDocCard = (doc: ExpedienteDoc) => {
    const isUploading = uploading === doc.tipo;

    return (
      <div key={doc.tipo} className={`rounded-md bg-card p-2.5 ${statusBorder(doc.status)} transition-colors`}>
        <div className="flex items-center gap-2">
          <StatusIcon status={doc.status} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium leading-tight truncate">{doc.label}</p>
            {doc.nombre && (
              <p className="text-[10px] text-muted-foreground truncate">{doc.nombre}</p>
            )}
          </div>

          {/* Inline actions for processed docs */}
          {doc.status === "procesado" && (
            <div className="flex items-center gap-0.5 shrink-0">
              {onReplaceDocument && (
                <>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    ref={(el) => { replaceRefs.current[doc.tipo] = el; }}
                    onChange={(e) => handleReplaceChange(doc.tipo, e)}
                  />
                  <button
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    disabled={isUploading}
                    onClick={() => replaceRefs.current[doc.tipo]?.click()}
                    title="Reemplazar"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              {onDeleteDocument && (
                <button
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => setDeleteTarget(doc.tipo)}
                  title="Eliminar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

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
              className="w-full h-7 text-xs border-dashed border-notarial-gold/50 text-notarial-gold hover:bg-notarial-gold/10 hover:text-notarial-gold"
              disabled={isUploading}
              onClick={() => fileRefs.current[doc.tipo]?.click()}
            >
              {isUploading ? (
                <><Clock className="mr-1.5 h-3 w-3 animate-spin" /> Procesando...</>
              ) : (
                <><Upload className="mr-1.5 h-3 w-3" /> Subir documento</>
              )}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header — notarial dark */}
      <div className="shrink-0 p-4 pb-3 bg-[hsl(var(--notarial-dark))] text-white">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-notarial-gold" />
          Documentos Cargados
        </h3>
        <div className="mt-2 flex items-center gap-2">
          <Progress value={progressPct} className="h-1.5 flex-1 bg-white/20 [&>div]:bg-notarial-gold" />
          <span className="text-[10px] text-white/70 shrink-0">{procesados}/{total}</span>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-4">
          {/* Section 1: Documentos Obligatorios */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Documentos Obligatorios
            </p>
            <div className="space-y-1.5">
              {obligatorios.map(renderDocCard)}
            </div>
          </div>

          <Separator />

          {/* Section 2: Cédulas de Identidad */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Cédulas de Identidad
            </p>
            <div className="space-y-1.5">
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
                  className="w-full h-8 text-xs border-dashed border-notarial-gold/50 text-notarial-gold hover:bg-notarial-gold/10 hover:text-notarial-gold gap-1"
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
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium cursor-pointer" htmlFor="toggle-credito">
                    ¿Tiene Crédito Hipotecario?
                  </label>
                  <Switch
                    id="toggle-credito"
                    checked={toggles?.tieneCredito ?? false}
                    onCheckedChange={(v) => onToggleChange?.("tieneCredito", v)}
                    className="data-[state=checked]:bg-notarial-green"
                  />
                </div>
                {toggles?.tieneCredito && opcionales.filter(d => d.tipo === "carta_credito").map(renderDocCard)}
              </div>

              {/* Toggle: Apoderado */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium cursor-pointer" htmlFor="toggle-apoderado">
                    ¿Tiene Apoderado?
                  </label>
                  <Switch
                    id="toggle-apoderado"
                    checked={toggles?.tieneApoderado ?? false}
                    onCheckedChange={(v) => onToggleChange?.("tieneApoderado", v)}
                    className="data-[state=checked]:bg-notarial-green"
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
