import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, Clock, TrendingUp } from "lucide-react";

interface SystemEvent {
  id: string;
  evento: string;
  resultado: string;
  categoria: string;
  detalle: Record<string, any>;
  tiempo_ms: number | null;
  created_at: string;
  organization_id: string | null;
  tramite_id: string | null;
}

const resultadoBadge = (r: string) => {
  switch (r) {
    case "success":
      return <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">OK</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    case "warning":
      return <Badge variant="outline" className="border-yellow-500/30 bg-yellow-500/10 text-yellow-700">Warn</Badge>;
    default:
      return <Badge variant="secondary">{r}</Badge>;
  }
};

export default function SystemMonitor() {
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEvento, setFilterEvento] = useState<string>("all");
  const [filterResultado, setFilterResultado] = useState<string>("all");

  const fetchEvents = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("system_events" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setEvents((data as any as SystemEvent[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  // Metrics
  const last24h = useMemo(() => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return events.filter((e) => e.created_at >= cutoff);
  }, [events]);

  const metrics = useMemo(() => {
    const total = last24h.length;
    const errors = last24h.filter((e) => e.resultado === "error").length;
    const successRate = total > 0 ? Math.round(((total - errors) / total) * 100) : 100;
    const avgTime = last24h.filter((e) => e.tiempo_ms).reduce((s, e) => s + (e.tiempo_ms || 0), 0) /
      (last24h.filter((e) => e.tiempo_ms).length || 1);

    // Recurring errors (3+ of same event type)
    const errorCounts: Record<string, number> = {};
    last24h.filter((e) => e.resultado === "error").forEach((e) => {
      errorCounts[e.evento] = (errorCounts[e.evento] || 0) + 1;
    });
    const recurringErrors = Object.entries(errorCounts).filter(([, c]) => c >= 3);

    return { total, errors, successRate, avgTime: Math.round(avgTime), recurringErrors };
  }, [last24h]);

  // Health status
  const healthStatus = metrics.recurringErrors.length > 0 ? "critical" :
    metrics.errors > 0 ? "warning" : "healthy";

  const healthColor = healthStatus === "critical" ? "text-destructive" :
    healthStatus === "warning" ? "text-yellow-600" : "text-emerald-600";

  // Filter
  const eventTypes = [...new Set(events.map((e) => e.evento))];
  const filtered = events.filter((e) => {
    if (filterEvento !== "all" && e.evento !== filterEvento) return false;
    if (filterResultado !== "all" && e.resultado !== filterResultado) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Health overview */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Activity className={`h-5 w-5 ${healthColor}`} />
            <div>
              <p className="text-xs text-muted-foreground">Salud del Sistema</p>
              <p className={`text-lg font-bold capitalize ${healthColor}`}>{healthStatus === "healthy" ? "Saludable" : healthStatus === "warning" ? "Atención" : "Crítico"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Eventos 24h</p>
              <p className="text-lg font-bold">{metrics.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-xs text-muted-foreground">Tasa de Éxito</p>
              <p className="text-lg font-bold">{metrics.successRate}%</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Tiempo Promedio</p>
              <p className="text-lg font-bold">{metrics.avgTime > 1000 ? `${(metrics.avgTime / 1000).toFixed(1)}s` : `${metrics.avgTime}ms`}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recurring errors alert */}
      {metrics.recurringErrors.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Errores Recurrentes (últimas 24h)</p>
              <ul className="mt-1 text-sm text-muted-foreground space-y-1">
                {metrics.recurringErrors.map(([evento, count]) => (
                  <li key={evento}><strong>{evento}</strong>: {count} errores</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={filterEvento} onValueChange={setFilterEvento}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filtrar por evento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los eventos</SelectItem>
            {eventTypes.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterResultado} onValueChange={setFilterResultado}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Resultado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="success">Éxito</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchEvents} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* Events table */}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Tiempo</TableHead>
                <TableHead>Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 100).map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(ev.created_at).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{ev.evento}</TableCell>
                  <TableCell>{resultadoBadge(ev.resultado)}</TableCell>
                  <TableCell className="text-xs">{ev.categoria}</TableCell>
                  <TableCell className="text-xs">
                    {ev.tiempo_ms ? (ev.tiempo_ms > 1000 ? `${(ev.tiempo_ms / 1000).toFixed(1)}s` : `${ev.tiempo_ms}ms`) : "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    {ev.detalle && Object.keys(ev.detalle).length > 0 ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Ver</summary>
                        <pre className="mt-1 whitespace-pre-wrap bg-muted p-2 rounded text-[10px] max-h-32 overflow-auto">
                          {JSON.stringify(ev.detalle, null, 2)}
                        </pre>
                      </details>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No hay eventos registrados
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
