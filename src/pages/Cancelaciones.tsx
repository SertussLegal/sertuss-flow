import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, FileText, X, Sparkles, Loader2, FileSearch } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type CancelacionRow = {
  id: string;
  matricula_inmobiliaria: string | null;
  deudor_nombre: string | null;
  deudor_cedula: string | null;
  status: "draft" | "processing" | "completed" | "error";
  created_at: string;
};

const BANCO_FIJO = "Banco Davivienda S.A.";
export const PLANTILLAS_BUCKET = "cancelaciones-plantillas";
export const PLANTILLAS_PREFIX_DAVIVIENDA = "davivienda/";

const QUERY_KEY = ["cancelaciones"] as const;

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));

const StatusBadge = ({ status }: { status: CancelacionRow["status"] }) => {
  if (status === "processing") {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border border-amber-200 gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        Procesando
      </Badge>
    );
  }
  if (status === "completed") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border border-emerald-200">
        Completada
      </Badge>
    );
  }
  if (status === "error") {
    return <Badge variant="destructive">Error</Badge>;
  }
  return (
    <Badge variant="secondary" className="text-muted-foreground">
      Borrador
    </Badge>
  );
};

type DropzoneProps = {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
};

const Dropzone = ({ label, file, onFile }: DropzoneProps) => {
  const [hover, setHover] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (!f) return;
      if (f.type !== "application/pdf") {
        toast.error("Solo se admiten archivos PDF");
        return;
      }
      onFile(f);
    },
    [onFile],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
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
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setHover(true);
          }}
          onDragLeave={() => setHover(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors",
            hover
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/60 hover:bg-muted/40",
          )}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm font-medium">
            Arrastra el PDF aquí o haz clic para seleccionar
          </p>
          <p className="text-xs text-muted-foreground">Solo archivos .pdf</p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
};

const NuevaCancelacionDialog = ({
  open,
  onOpenChange,
  organizationId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string | null;
  onCreated: () => void;
}) => {
  const [certificado, setCertificado] = useState<File | null>(null);
  const [escritura, setEscritura] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCertificado(null);
    setEscritura(null);
    setSaving(false);
  };

  const handleClose = (v: boolean) => {
    if (saving) return;
    if (!v) reset();
    onOpenChange(v);
  };

  const handleSubmit = async () => {
    if (!organizationId) {
      toast.error("No hay organización activa");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("cancelaciones").insert({
      organization_id: organizationId,
      status: "draft",
    });
    setSaving(false);
    if (error) {
      toast.error("No se pudo crear la cancelación", { description: error.message });
      return;
    }
    toast.success("Cancelación creada en borrador", {
      description: `Banco: ${BANCO_FIJO}`,
    });
    reset();
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nueva cancelación de hipoteca</DialogTitle>
          <DialogDescription>
            Selecciona el banco acreedor y adjunta los documentos requeridos para iniciar el trámite.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                1
              </span>
              <h3 className="text-sm font-semibold">Banco acreedor</h3>
            </div>
            <Input
              value={BANCO_FIJO}
              disabled
              readOnly
              className="font-medium"
              aria-label="Banco acreedor"
            />
            <p className="text-xs text-muted-foreground">
              Este módulo opera exclusivamente con {BANCO_FIJO}. Las plantillas y reglas
              de procesamiento están configuradas para esta entidad.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                2
              </span>
              <h3 className="text-sm font-semibold">Documentos de soporte</h3>
            </div>
            <Dropzone
              label="Certificado de Tradición y Libertad (PDF)"
              file={certificado}
              onFile={setCertificado}
            />
            <Dropzone
              label="Escritura Pública de Constitución de Hipoteca (PDF)"
              file={escritura}
              onFile={setEscritura}
            />
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Procesar con IA
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Cancelaciones = () => {
  const { activeOrgId } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cancelaciones")
        .select("id, matricula_inmobiliaria, deudor_nombre, deudor_cedula, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CancelacionRow[];
    },
  });

  const rows = data ?? [];
  const hasRows = rows.length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cancelaciones de hipoteca</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Historial de cancelaciones procesadas para tu organización.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nueva cancelación
        </Button>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !hasRows ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <FileSearch className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">No hay cancelaciones registradas aún</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Cuando inicies un trámite de cancelación de hipoteca, aparecerá aquí su historial completo.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Matrícula Inmobiliaria</TableHead>
                <TableHead>Deudor</TableHead>
                <TableHead>Cédula</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.matricula_inmobiliaria || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.deudor_nombre || <span className="text-muted-foreground">Sin asignar</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.deudor_cedula || "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(row.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <NuevaCancelacionDialog
        open={open}
        onOpenChange={setOpen}
        organizationId={activeOrgId}
        onCreated={() => queryClient.invalidateQueries({ queryKey: QUERY_KEY })}
      />
    </div>
  );
};

export default Cancelaciones;
