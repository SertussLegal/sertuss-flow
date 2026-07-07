import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Lightbulb, Loader2, Play } from "lucide-react";
import PropuestaDetalleModal from "./PropuestaDetalleModal";

interface Propuesta {
  id: string;
  titulo: string;
  tipo_acto: string;
  categoria: string;
  nivel_severidad: string;
  frecuencia_estimada: number;
  status: string;
  created_at: string;
}

interface Run {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  tramites_analizados: number | null;
  propuestas_generadas: number | null;
  costo_estimado_usd: number | null;
  costo_estimado_cop: number | null;
  error_detalle: unknown;
}

function formatCosto(usd: number | null, cop: number | null): ReactNode {
  if (usd == null && cop == null) return <span className="text-muted-foreground">—</span>;
  const copFmt =
    cop != null
      ? new Intl.NumberFormat("es-CO", {
          style: "currency",
          currency: "COP",
          maximumFractionDigits: 0,
        }).format(cop)
      : null;
  const usdFmt =
    usd != null
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
        }).format(usd)
      : null;
  return (
    <span className="tabular-nums">
      {copFmt && <span className="text-foreground">≈ {copFmt}</span>}
      {copFmt && usdFmt && " "}
      {usdFmt && <span className="text-xs text-muted-foreground">({usdFmt})</span>}
    </span>
  );
}

const severidadBadge = (nivel: string) => {
  const map: Record<string, string> = {
    error: "bg-destructive/10 text-destructive border-destructive/30",
    advertencia: "bg-yellow-100 text-yellow-800 border-yellow-300",
    sugerencia: "bg-notarial-blue/10 text-notarial-blue border-notarial-blue/30",
  };
  return (
    <Badge variant="outline" className={map[nivel] ?? ""}>
      {nivel}
    </Badge>
  );
};

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
    aprobada: "bg-notarial-green/10 text-notarial-green border-notarial-green/30",
    rechazada: "bg-destructive/10 text-destructive border-destructive/30",
    duplicada: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={map[status] ?? ""}>
      {status}
    </Badge>
  );
};

const statusOrder: Record<string, number> = {
  pendiente: 0,
  aprobada: 1,
  rechazada: 2,
  duplicada: 3,
};

const RUN_SELECT =
  "id, started_at, finished_at, status, tramites_analizados, propuestas_generadas, costo_estimado_usd, costo_estimado_cop, error_detalle";

const ReglasPropuestas = () => {
  const { toast } = useToast();
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const pollRef = useRef<number | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const loadPropuestas = useCallback(async () => {
    const { data, error } = await supabase
      .from("regla_propuesta")
      .select(
        "id, titulo, tipo_acto, categoria, nivel_severidad, frecuencia_estimada, status, created_at"
      )
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Error cargando propuestas", description: error.message, variant: "destructive" });
      return;
    }
    setPropuestas((data as Propuesta[]) ?? []);
  }, [toast]);

  const loadLastRun = useCallback(async () => {
    const { data, error } = await supabase
      .from("regla_propuesta_run")
      .select(RUN_SELECT)
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) {
      toast({ title: "Error cargando run", description: error.message, variant: "destructive" });
      return null;
    }
    const run = ((data as Run[]) ?? [])[0] ?? null;
    setLastRun(run);
    return run;
  }, [toast]);

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadPropuestas(), loadLastRun()]);
      setLoading(false);
    };
    init();
    return () => stopPolling();
  }, [loadPropuestas, loadLastRun, stopPolling]);

  const pollRun = useCallback(
    (runId: string) => {
      activeRunIdRef.current = runId;
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        const { data, error } = await supabase
          .from("regla_propuesta_run")
          .select(RUN_SELECT)
          .eq("id", runId)
          .maybeSingle();
        if (error) return;
        if (!data) return;
        const run = data as Run;
        setLastRun(run);
        if (run.status === "success" || run.status === "error") {
          stopPolling();
          setRunning(false);
          activeRunIdRef.current = null;
          await loadPropuestas();
          const n = run.propuestas_generadas ?? 0;
          if (run.status === "success") {
            toast({
              title: `${n} propuesta${n === 1 ? "" : "s"} ${n === 1 ? "nueva" : "nuevas"} para revisar`,
              description: `Análisis completado sobre ${run.tramites_analizados ?? 0} trámites.`,
            });
          } else {
            const msg =
              (run.error_detalle as { message?: string } | null)?.message ??
              "El análisis terminó con error.";
            toast({
              title: "Error en el análisis",
              description: msg,
              variant: "destructive",
            });
          }
        }
      }, 3000);
    },
    [loadPropuestas, stopPolling, toast]
  );

  const handleRun = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("descubrir-reglas", { body: {} });
      if (error) throw error;
      const runId = (data as { run_id?: string })?.run_id;
      if (!runId) throw new Error("La función no devolvió run_id.");
      const run = await loadLastRun();
      if (run && (run.status === "success" || run.status === "error") && run.id === runId) {
        // Ya terminó (rápido). Cerrar ciclo.
        setRunning(false);
        await loadPropuestas();
        const n = run.propuestas_generadas ?? 0;
        if (run.status === "success") {
          toast({
            title: `${n} propuesta${n === 1 ? "" : "s"} ${n === 1 ? "nueva" : "nuevas"} para revisar`,
          });
        } else {
          toast({ title: "Error en el análisis", variant: "destructive" });
        }
        return;
      }
      pollRun(runId);
    } catch (err) {
      setRunning(false);
      toast({
        title: "No se pudo iniciar el análisis",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [running, loadLastRun, loadPropuestas, pollRun, toast]);

  const tiposActo = useMemo(() => {
    const set = new Set(propuestas.map((p) => p.tipo_acto));
    return Array.from(set).sort();
  }, [propuestas]);

  const filtradas = useMemo(() => {
    return propuestas
      .filter((p) => filtroStatus === "todos" || p.status === filtroStatus)
      .filter((p) => filtroTipo === "todos" || p.tipo_acto === filtroTipo)
      .sort((a, b) => {
        const sa = statusOrder[a.status] ?? 99;
        const sb = statusOrder[b.status] ?? 99;
        if (sa !== sb) return sa - sb;
        return (b.frecuencia_estimada ?? 0) - (a.frecuencia_estimada ?? 0);
      });
  }, [propuestas, filtroStatus, filtroTipo]);

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("es-CO", {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  const parcial =
    lastRun?.status === "error" && (lastRun.propuestas_generadas ?? 0) > 0
      ? lastRun.propuestas_generadas
      : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-notarial-gold" />
              Descubrimiento de reglas nuevas
            </CardTitle>
          </div>
          <Button onClick={handleRun} disabled={running} size="sm">
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analizando... esto puede tardar 20-90 segundos
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Ejecutar análisis ahora
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {lastRun ? (
            <p className="text-sm text-muted-foreground">
              Último análisis: {formatDate(lastRun.started_at)} ·{" "}
              {lastRun.tramites_analizados ?? 0} trámites ·{" "}
              {lastRun.propuestas_generadas ?? 0} propuestas · Costo:{" "}
              {formatCosto(lastRun.costo_estimado_usd, lastRun.costo_estimado_cop)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Aún no se ha ejecutado ningún análisis.</p>
          )}
          {parcial != null && (
            <p className="text-sm text-destructive">
              Análisis parcial: se guardaron {parcial} propuestas antes del error.
            </p>
          )}
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-base">Propuestas ({filtradas.length})</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los status</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="aprobada">Aprobada</SelectItem>
                <SelectItem value="rechazada">Rechazada</SelectItem>
                <SelectItem value="duplicada">Duplicada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tipo de acto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los tipos</SelectItem>
                {tiposActo.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Tipo de acto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Severidad</TableHead>
                <TableHead className="text-right">Frecuencia</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    setSelectedId(p.id);
                    setModalOpen(true);
                  }}
                >
                  <TableCell className="font-medium max-w-md">{p.titulo}</TableCell>
                  <TableCell className="capitalize">{p.tipo_acto}</TableCell>
                  <TableCell className="capitalize">{p.categoria}</TableCell>
                  <TableCell>{severidadBadge(p.nivel_severidad)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.frecuencia_estimada}
                  </TableCell>
                  <TableCell>{statusBadge(p.status)}</TableCell>
                </TableRow>
              ))}
              {!loading && filtradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No hay propuestas que coincidan con el filtro.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PropuestaDetalleModal
        propuestaId={selectedId}
        open={modalOpen}
        onOpenChange={(o) => {
          setModalOpen(o);
          if (!o) setSelectedId(null);
        }}
        onReviewed={loadPropuestas}
      />
    </div>
  );
};

export default ReglasPropuestas;
