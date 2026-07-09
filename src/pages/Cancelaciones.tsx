import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Eye, FileSearch, Loader2, Plus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  status: "draft" | "processing" | "completed" | "error" | "requiere_revision_manual";
  revision_manual_requerida: boolean;
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
  if (status === "requiere_revision_manual") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className="gap-1.5 border border-red-300 bg-red-100 text-red-800 hover:bg-red-100 cursor-help">
            <AlertTriangle className="h-3 w-3" />
            Bloqueada
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-snug">
          La IA no pudo leer con confianza uno o más campos obligatorios. El documento no se puede generar hasta que un humano revise y corrija los datos marcados.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Badge variant="secondary" className="text-muted-foreground">
      Borrador
    </Badge>
  );
};

const ManualReviewChip = () => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Badge
        className="gap-1 border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-50 cursor-help"
        aria-label="Con alertas históricas de revisión manual"
      >
        <AlertTriangle className="h-3 w-3" />
        Con alertas
      </Badge>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs text-xs leading-snug">
      En algún momento uno o más campos quedaron marcados como poco legibles y fueron confirmados manualmente. Esta marca se conserva solo para trazabilidad histórica.
    </TooltipContent>
  </Tooltip>
);

type FilterKey = "all" | "review" | "completed";

const Cancelaciones = () => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    // Fix C: stale-while-revalidate. Background refetch silencioso al volver a la sección,
    // sin parpadeo: la lista previa permanece en pantalla mientras se actualiza.
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cancelaciones")
        .select(
          "id, matricula_inmobiliaria, deudor_nombre, deudor_cedula, status, revision_manual_requerida, created_at"
        )
        .order("revision_manual_requerida", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CancelacionRow[];
    },
  });

  // Fix F: skeleton SOLO en el primer fetch real (sin data previa).
  const isInitialLoading = isLoading && !data;

  const rows = data ?? [];

  const counts = useMemo(() => {
    const review = rows.filter(
      (r) => r.revision_manual_requerida || r.status === "requiere_revision_manual"
    ).length;
    const completed = rows.filter(
      (r) => r.status === "completed" && !r.revision_manual_requerida
    ).length;
    return { all: rows.length, review, completed };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "review") {
      return rows.filter(
        (r) => r.revision_manual_requerida || r.status === "requiere_revision_manual"
      );
    }
    if (filter === "completed") {
      return rows.filter(
        (r) => r.status === "completed" && !r.revision_manual_requerida
      );
    }
    return rows;
  }, [rows, filter]);

  const hasAnyRow = rows.length > 0;
  const hasRows = filteredRows.length > 0;

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
        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Historial de Cancelaciones</h2>
          {hasAnyRow && (
            <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
              <TabsList>
                <TabsTrigger value="all">Todas ({counts.all})</TabsTrigger>
                <TabsTrigger value="review">Requieren revisión ({counts.review})</TabsTrigger>
                <TabsTrigger value="completed">Completadas ({counts.completed})</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
        {isInitialLoading ? (
          <div data-testid="page-skeleton" className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !hasAnyRow ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <FileSearch className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">No hay cancelaciones registradas aún</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Cuando inicies un trámite de cancelación de hipoteca, aparecerá aquí su historial completo.
            </p>
          </div>
        ) : !hasRows ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <FileSearch className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">No hay cancelaciones que coincidan con este filtro</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Prueba con otro filtro o vuelve a "Todas" para ver el historial completo.
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
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => navigate(`/cancelaciones/${row.id}/validar`)}
                  aria-label="Abrir cancelación"
                >
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
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={row.status} />
                      {row.revision_manual_requerida && <ManualReviewChip />}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(row.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/cancelaciones/${row.id}/validar`);
                      }}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Abrir
                    </Button>
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
