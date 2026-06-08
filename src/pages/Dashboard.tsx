import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Search, AlertTriangle, FileEdit, ArrowRight, Clock, Trash2, Timer, User, Building2, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import SetupOrgModal from "@/components/SetupOrgModal";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const statusColors: Record<string, string> = {
  pendiente: "border border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100",
  validado: "border border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  word_generado: "border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100",
};

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  validado: "Validado",
  word_generado: "Word Generado",
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, profile, organization, refreshProfile, needsOrgSetup } = useAuth();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [tramites, setTramites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftToDelete, setDraftToDelete] = useState<any | null>(null);
  // Hallazgo 6: evita doble click → 4 deletes en paralelo. Disabled + spinner.
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (profile?.organization_id) {
      refreshProfile();
      fetchTramites();
    }
  }, [profile?.organization_id]);

  const fetchTramites = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("tramites")
      .select("*, personas(count), inmuebles(count)")
      .order("updated_at", { ascending: false });
    setTramites(data ?? []);
    setLoading(false);
  };

  const drafts = tramites.filter((t) => t.status === "pendiente");
  const completedTramites = tramites.filter((t) => t.status !== "pendiente");

  const filtered = completedTramites.filter((t) => {
    const matchSearch =
      (t.radicado ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (t.tipo ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || t.status === filterStatus;
    return matchSearch && matchStatus;
  });


  const handleNewTramite = () => {
    navigate("/nuevo-tramite");
  };

  const handleDeleteDraft = async () => {
    if (!draftToDelete) return;
    try {
      await supabase.from("logs_extraccion").delete().eq("tramite_id", draftToDelete.id);
      await supabase.from("personas").delete().eq("tramite_id", draftToDelete.id);
      await supabase.from("inmuebles").delete().eq("tramite_id", draftToDelete.id);
      await supabase.from("actos").delete().eq("tramite_id", draftToDelete.id);
      const { error } = await supabase.from("tramites").delete().eq("id", draftToDelete.id);
      if (error) throw error;
      toast({ title: "Borrador eliminado" });
      await fetchTramites();
    } catch (err: any) {
      toast({ title: "Error al eliminar", description: err?.message ?? "Intenta de nuevo", variant: "destructive" });
    } finally {
      setDraftToDelete(null);
    }
  };

  const getDraftProgress = (t: any) => {
    return t.metadata?.progress ?? 0;
  };

  const getDraftSummary = (t: any) => {
    const parts: string[] = [];
    const personasCount = t.personas?.[0]?.count ?? 0;
    const inmueblesCount = t.inmuebles?.[0]?.count ?? 0;
    if (personasCount > 0) parts.push(`${personasCount} persona(s)`);
    if (inmueblesCount > 0) parts.push(`${inmueblesCount} inmueble(s)`);
    return parts.length > 0 ? parts.join(" · ") : "Sin datos aún";
  };

  const getDaysRemaining = (t: any) => {
    const updated = new Date(t.updated_at);
    const expiry = new Date(updated.getTime() + 15 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const days = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, days);
  };

  return (
    <div className="min-h-screen bg-muted/30">
      {needsOrgSetup && user && (
        <SetupOrgModal
          open={true}
          userId={user.id}
          onComplete={() => refreshProfile()}
        />
      )}

      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Escrituras</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Historial de escrituras gestionadas por tu organización.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(!organization?.nit || !organization?.name) && (
              <div className="flex items-center gap-1 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Completa los Datos Legales (Razón Social y NIT)</span>
              </div>
            )}
            <Button
              onClick={handleNewTramite}
              className="gap-2"
              disabled={!organization?.nit || !organization?.name}
            >
              <Plus className="h-4 w-4" /> Nueva Escritura
            </Button>
          </div>
        </header>


        {/* Drafts section */}
        {drafts.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <FileEdit className="h-5 w-5 text-accent" />
                <h2 className="text-lg font-semibold">Borradores en progreso</h2>
                <Badge variant="secondary" className="text-xs">{drafts.length}</Badge>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Timer className="h-3.5 w-3.5" />
                Borradores inactivos se eliminan tras 15 días.
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {drafts.slice(0, 4).map((t) => {
                const progress = getDraftProgress(t);
                const daysLeft = getDaysRemaining(t);
                const isExpiringSoon = daysLeft <= 3;
                return (
                  <Card
                    key={t.id}
                    className="group relative cursor-pointer border-border bg-background transition-all hover:border-primary/40 hover:shadow-md"
                    onClick={() => navigate(`/tramite/${t.id}`)}
                  >
                    <CardContent className="flex flex-col gap-3 p-4">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-foreground truncate text-sm">
                            {t.tipo || "Nuevo trámite"}
                          </h3>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                          onClick={(e) => { e.stopPropagation(); setDraftToDelete(t); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {/* Summary */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="h-3 w-3 shrink-0" />
                          <span className="truncate">{getDraftSummary(t)}</span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-1.5 flex-1" />
                        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">{progress}%</span>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between pt-1 border-t border-border/50">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">
                            {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true, locale: es })}
                          </span>
                          {isExpiringSoon && (
                            <Badge variant="destructive" className="text-[9px] px-1.5 py-0 h-4">
                              {daysLeft}d restantes
                            </Badge>
                          )}
                        </div>
                        <span className="flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                          Continuar <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar por radicado o tipo..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="validado">Validado</SelectItem>
                <SelectItem value="word_generado">Word Generado</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Historial de Escrituras</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Radicado</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/tramite/${t.id}`)}>
                    <TableCell className="font-medium">{t.radicado ?? "—"}</TableCell>
                    <TableCell>{t.tipo ?? "—"}</TableCell>
                    <TableCell>{t.fecha ?? "—"}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[t.status] ?? ""}>{statusLabels[t.status] ?? t.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm">Abrir</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="p-0">
                      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                          <Search className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h2 className="text-base font-semibold">No se encontraron escrituras</h2>
                        <p className="max-w-sm text-sm text-muted-foreground">
                          Cuando inicies una nueva escritura, aparecerá aquí su historial completo.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>

            </Table>
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!draftToDelete} onOpenChange={(open) => !open && setDraftToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar borrador?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará permanentemente el borrador "{draftToDelete?.tipo || "Nuevo trámite"}". Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDraft} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard;
