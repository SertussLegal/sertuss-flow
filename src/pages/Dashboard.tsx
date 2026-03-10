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
import { Plus, Search, LogOut, Scale, Users, AlertTriangle, Shield, FileEdit, ArrowRight, Clock, Trash2 } from "lucide-react";
import SetupOrgModal from "@/components/SetupOrgModal";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const statusColors: Record<string, string> = {
  pendiente: "bg-yellow-100 text-yellow-800 border-yellow-300",
  validado: "bg-notarial-green/10 text-notarial-green border-notarial-green/30",
  word_generado: "bg-notarial-blue/10 text-notarial-blue border-notarial-blue/30",
};

const statusLabels: Record<string, string> = {
  pendiente: "Pendiente",
  validado: "Validado",
  word_generado: "Word Generado",
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, profile, organization, credits, refreshProfile, needsOrgSetup } = useAuth();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [tramites, setTramites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftToDelete, setDraftToDelete] = useState<any | null>(null);
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
      .select("*")
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const handleDeleteDraft = async () => {
    if (!draftToDelete) return;
    try {
      await supabase.from("personas").delete().eq("tramite_id", draftToDelete.id);
      await supabase.from("inmuebles").delete().eq("tramite_id", draftToDelete.id);
      await supabase.from("actos").delete().eq("tramite_id", draftToDelete.id);
      await supabase.from("tramites").delete().eq("id", draftToDelete.id);
      setTramites((prev) => prev.filter((t) => t.id !== draftToDelete.id));
      toast({ title: "Borrador eliminado" });
    } catch {
      toast({ title: "Error al eliminar", variant: "destructive" });
    } finally {
      setDraftToDelete(null);
    }
  };

  const getDraftDescription = (t: any) => {
    const meta = t.metadata;
    const matricula = meta?.custom_variables?.length
      ? `${meta.custom_variables.length} variable(s)`
      : null;
    return matricula || "Sin datos aún";
  };

  return (
    <div className="min-h-screen bg-background">
      {needsOrgSetup && user && (
        <SetupOrgModal
          open={true}
          userId={user.id}
          onComplete={() => refreshProfile()}
        />
      )}
      <header className="border-b bg-notarial-dark text-white">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-notarial-gold" />
            <span className="text-lg font-bold">Sertuss</span>
          </div>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="border-notarial-gold/30 text-notarial-gold">
              {credits} créditos
            </Badge>
            {profile?.role === "owner" && (
              <Button variant="ghost-dark" size="sm" onClick={() => navigate("/admin")}>
                <Shield className="mr-1 h-4 w-4" /> Admin
              </Button>
            )}
            {(profile?.role === "owner" || profile?.role === "admin") && (
              <Button variant="ghost-dark" size="sm" onClick={() => navigate("/equipo")}>
                <Users className="mr-1 h-4 w-4" /> Equipo
              </Button>
            )}
            <Button variant="ghost-dark" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" /> Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold">Escrituras</h1>
          <div className="flex items-center gap-3">
            {!organization?.nit || !organization?.name ? (
              <div className="flex items-center gap-1 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Completa los Datos Legales (Razón Social y NIT)</span>
              </div>
            ) : credits === 0 ? (
              <div className="flex items-center gap-1 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Bolsa de créditos agotada</span>
              </div>
            ) : null}
            <Button
              onClick={() => navigate("/tramite/nuevo")}
              className="bg-notarial-green hover:bg-notarial-green/90"
              disabled={credits === 0 || !organization?.nit || !organization?.name}
            >
              <Plus className="mr-2 h-4 w-4" /> Nuevo Trámite
            </Button>
          </div>
        </div>

        {/* Drafts section */}
        {drafts.length > 0 && (
          <div className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-accent" />
              <h2 className="text-lg font-semibold">Borradores en progreso</h2>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {drafts.slice(0, 4).map((t) => (
                <Card
                  key={t.id}
                  className="min-w-[240px] max-w-[280px] shrink-0 cursor-pointer border-accent/30 transition-shadow hover:shadow-md"
                  onClick={() => navigate(`/tramite/${t.id}`)}
                >
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-foreground">
                        {t.tipo || "Nuevo trámite"}
                      </span>
                      <Badge variant="outline" className="shrink-0 border-accent/40 text-accent text-xs">
                        Borrador
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-1">
                      {getDraftDescription(t)}
                    </p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(t.updated_at), { addSuffix: true, locale: es })}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 text-muted-foreground hover:text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDraftToDelete(t); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="link" size="sm" className="h-auto p-0 text-primary">
                          Continuar <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
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
          <CardHeader><CardTitle className="text-lg">Trámites</CardTitle></CardHeader>
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
                      <Badge variant="outline" className={statusColors[t.status] ?? ""}>{statusLabels[t.status] ?? t.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm">Abrir</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No se encontraron trámites</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Dashboard;
