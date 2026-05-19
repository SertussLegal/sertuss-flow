import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileSearch, Loader2, Plus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type CancelacionRow = {
  id: string;
  matricula_inmobiliaria: string | null;
  deudor_nombre: string | null;
  deudor_cedula: string | null;
  status: "draft" | "processing" | "completed" | "error";
  created_at: string;
};

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
      <Badge className="gap-1.5 border border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100">
        <Loader2 className="h-3 w-3 animate-spin" />
        Procesando
      </Badge>
    );
  }
  if (status === "completed") {
    return (
      <Badge className="border border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
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

const Cancelaciones = () => {
  const navigate = useNavigate();

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
        <Button onClick={() => navigate("/cancelaciones/nueva")} className="gap-2">
          <Plus className="h-4 w-4" />
          Nueva Cancelación
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
    </div>
  );
};

export default Cancelaciones;
