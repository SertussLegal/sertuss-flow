import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Scale, UserPlus, Users, Activity, Pencil, Check, X, CalendarIcon, Download, Coins, FileText, Trophy,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay, subDays, startOfWeek, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import ProfileSwitcher from "@/components/ProfileSwitcher";

interface MemberRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "owner" | "admin" | "operator";
}

interface ConsumptionRow {
  id: string;
  user_id: string;
  tramite_id: string | null;
  action: string;
  credits: number;
  tipo_acto: string | null;
  created_at: string;
}

const Team = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, organization, credits } = useAuth();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("operator");
  const [loading, setLoading] = useState(false);

  // inline name edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  // Consumption tab
  const [consumption, setConsumption] = useState<ConsumptionRow[]>([]);
  const [loadingCons, setLoadingCons] = useState(false);
  const [filterMember, setFilterMember] = useState<string>("all");
  const [filterAction, setFilterAction] = useState<string>("all");
  const today = new Date();
  const [range, setRange] = useState<DateRange | undefined>({
    from: startOfMonth(today),
    to: today,
  });
  const [calendarOpen, setCalendarOpen] = useState(false);

  const isAdminOrOwner = profile?.role === "owner" || profile?.role === "admin";

  useEffect(() => {
    if (profile?.organization_id) fetchMembers();
  }, [profile?.organization_id]);

  useEffect(() => {
    if (profile?.organization_id && isAdminOrOwner) fetchConsumption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.organization_id, range?.from, range?.to]);

  const fetchMembers = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("organization_id", profile!.organization_id!);
    if (data) setMembers(data as MemberRow[]);
  };

  const fetchConsumption = async () => {
    if (!profile?.organization_id || !range?.from) return;
    setLoadingCons(true);
    const from = startOfDay(range.from).toISOString();
    const to = endOfDay(range.to ?? range.from).toISOString();
    const { data, error } = await supabase
      .from("credit_consumption")
      .select("id, user_id, tramite_id, action, credits, tipo_acto, created_at")
      .eq("organization_id", profile.organization_id)
      .gte("created_at", from)
      .lte("created_at", to)
      .order("created_at", { ascending: false })
      .limit(1000);
    setLoadingCons(false);
    if (error) {
      toast({ title: "Error cargando consumo", description: error.message, variant: "destructive" });
      return;
    }
    setConsumption((data ?? []) as ConsumptionRow[]);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminOrOwner || !profile?.organization_id) return;
    setLoading(true);
    try {
      const { error } = await supabase.from("invitations").insert({
        organization_id: profile.organization_id,
        email: inviteEmail,
        role: inviteRole as any,
        invited_by: profile.id,
      });
      if (error) throw error;
      toast({ title: "Invitación enviada", description: `Se invitó a ${inviteEmail}` });
      setInviteEmail("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    if (!isAdminOrOwner) return;
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole as any })
      .eq("id", memberId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Rol actualizado" });
      fetchMembers();
    }
  };

  const beginEditName = (m: MemberRow) => {
    setEditingId(m.id);
    setNameDraft(m.full_name ?? "");
  };

  const saveName = async (memberId: string) => {
    const trimmed = nameDraft.trim();
    if (trimmed.length < 3) {
      toast({ title: "Nombre muy corto", description: "Mínimo 3 caracteres.", variant: "destructive" });
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: trimmed })
      .eq("id", memberId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Nombre actualizado" });
      setEditingId(null);
      fetchMembers();
    }
  };

  const memberById = useMemo(() => {
    const m = new Map<string, MemberRow>();
    members.forEach((x) => m.set(x.id, x));
    return m;
  }, [members]);

  const filteredConsumption = useMemo(() => {
    return consumption.filter((c) => {
      if (filterMember !== "all" && c.user_id !== filterMember) return false;
      if (filterAction !== "all" && c.action !== filterAction) return false;
      return true;
    });
  }, [consumption, filterMember, filterAction]);

  const kpis = useMemo(() => {
    const totalCredits = filteredConsumption.reduce((s, c) => s + c.credits, 0);
    const uniqueTramites = new Set(filteredConsumption.filter((c) => c.tramite_id).map((c) => c.tramite_id)).size;
    const byUser = new Map<string, number>();
    filteredConsumption.forEach((c) => byUser.set(c.user_id, (byUser.get(c.user_id) ?? 0) + c.credits));
    let topUserId: string | null = null;
    let topUserCredits = 0;
    byUser.forEach((v, k) => {
      if (v > topUserCredits) { topUserCredits = v; topUserId = k; }
    });
    const topUser = topUserId ? memberById.get(topUserId) : null;
    return { totalCredits, uniqueTramites, topUserName: topUser?.full_name ?? topUser?.email ?? "—", topUserCredits };
  }, [filteredConsumption, memberById]);

  const setQuickRange = (preset: "today" | "week" | "biweek" | "month" | "lastMonth" | "90d") => {
    const now = new Date();
    let from: Date; let to: Date = now;
    switch (preset) {
      case "today": from = startOfDay(now); break;
      case "week": from = startOfWeek(now, { locale: es }); break;
      case "biweek": {
        const day = now.getDate();
        from = day <= 15 ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), now.getMonth(), 16);
        break;
      }
      case "month": from = startOfMonth(now); break;
      case "lastMonth": {
        const prev = subMonths(now, 1);
        from = startOfMonth(prev);
        to = endOfMonth(prev);
        break;
      }
      case "90d": from = subDays(now, 90); break;
    }
    setRange({ from, to });
    setCalendarOpen(false);
  };

  const exportCsv = () => {
    const headers = ["Fecha", "Miembro", "Acción", "Tipo de acto", "Trámite", "Créditos"];
    const rows = filteredConsumption.map((c) => {
      const m = memberById.get(c.user_id);
      return [
        format(new Date(c.created_at), "yyyy-MM-dd HH:mm", { locale: es }),
        m?.full_name ?? m?.email ?? c.user_id,
        c.action,
        c.tipo_acto ?? "",
        c.tramite_id ?? "",
        String(c.credits),
      ];
    });
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fromStr = range?.from ? format(range.from, "yyyyMMdd") : "x";
    const toStr = range?.to ? format(range.to, "yyyyMMdd") : fromStr;
    a.href = url;
    a.download = `consumo_${fromStr}_${toStr}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const roleLabels: Record<string, string> = {
    owner: "Propietario",
    admin: "Administrador",
    operator: "Operador",
  };

  const actionLabels: Record<string, string> = {
    VALIDACION_CLAUDE: "Validación IA",
    OCR_DOCUMENTO: "OCR documento",
    APERTURA_EXPEDIENTE: "Apertura expediente",
    GENERACION_DOCX: "Generación Word",
    LEGACY: "Legado",
  };

  const rangeLabel = range?.from
    ? `${format(range.from, "dd MMM yyyy", { locale: es })}${range.to && range.to.getTime() !== range.from.getTime() ? ` — ${format(range.to, "dd MMM yyyy", { locale: es })}` : ""}`
    : "Selecciona rango";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-notarial-dark text-white">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-notarial-gold" />
            <span className="text-lg font-bold">Sertuss</span>
          </div>
          <div className="flex items-center gap-3">
            <ProfileSwitcher variant="dark" />
            <Badge variant="outline" className="border-notarial-gold/30 text-notarial-gold">
              {credits} créditos
            </Badge>
            <Button variant="ghost-dark" size="sm" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Dashboard
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Gestión de Equipo</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Organización: <strong>{organization?.name ?? "—"}</strong>
        </p>

        <Tabs defaultValue="miembros">
          <TabsList>
            <TabsTrigger value="miembros"><Users className="mr-1 h-4 w-4" /> Miembros</TabsTrigger>
            {isAdminOrOwner && (
              <TabsTrigger value="consumo"><Activity className="mr-1 h-4 w-4" /> Consumo</TabsTrigger>
            )}
          </TabsList>

          {/* ── MIEMBROS ─────────────────────── */}
          <TabsContent value="miembros" className="space-y-6 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Miembros</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Correo</TableHead>
                      <TableHead>Nombre completo</TableHead>
                      <TableHead>Rol</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                        <TableCell>
                          {editingId === m.id ? (
                            <div className="flex items-center gap-2">
                              <Input
                                autoFocus
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveName(m.id);
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                                className="h-8 max-w-xs"
                              />
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveName(m.id)}>
                                <Check className="h-4 w-4 text-notarial-green" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => isAdminOrOwner && beginEditName(m)}
                              className={cn(
                                "group flex items-center gap-2 text-left",
                                isAdminOrOwner && "cursor-pointer hover:underline"
                              )}
                              disabled={!isAdminOrOwner}
                            >
                              <span>{m.full_name || <em className="text-muted-foreground">Sin nombre</em>}</span>
                              {isAdminOrOwner && <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />}
                            </button>
                          )}
                        </TableCell>
                        <TableCell>
                          {isAdminOrOwner && m.id !== profile?.id && m.role !== "owner" ? (
                            <Select value={m.role} onValueChange={(v) => handleRoleChange(m.id, v)}>
                              <SelectTrigger className="w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Administrador</SelectItem>
                                <SelectItem value="operator">Operador</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary">{roleLabels[m.role] ?? m.role}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {isAdminOrOwner && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <UserPlus className="h-5 w-5" /> Invitar Miembro
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleInvite} className="flex flex-col gap-4 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-2">
                      <Label>Correo electrónico</Label>
                      <Input
                        type="email"
                        placeholder="correo@ejemplo.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="w-full sm:w-48 space-y-2">
                      <Label>Rol</Label>
                      <Select value={inviteRole} onValueChange={setInviteRole}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="operator">Operador</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="submit" disabled={loading} className="bg-notarial-green hover:bg-notarial-green/90">
                      {loading ? "Enviando..." : "Invitar"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── CONSUMO ─────────────────────── */}
          {isAdminOrOwner && (
            <TabsContent value="consumo" className="space-y-4 mt-4">
              {/* KPI cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <Coins className="h-8 w-8 text-notarial-gold" />
                    <div>
                      <div className="text-2xl font-bold">{kpis.totalCredits}</div>
                      <div className="text-xs text-muted-foreground">Créditos consumidos</div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <FileText className="h-8 w-8 text-notarial-blue" />
                    <div>
                      <div className="text-2xl font-bold">{kpis.uniqueTramites}</div>
                      <div className="text-xs text-muted-foreground">Trámites únicos</div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <Trophy className="h-8 w-8 text-notarial-green" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{kpis.topUserName}</div>
                      <div className="text-xs text-muted-foreground">Mayor consumo ({kpis.topUserCredits} cr.)</div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Filters */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Rango de fechas</Label>
                      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="h-9 justify-start gap-2 font-normal">
                            <CalendarIcon className="h-4 w-4" />
                            {rangeLabel}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 bg-popover" align="start">
                          <div className="flex flex-wrap gap-1 border-b p-2">
                            <Button size="sm" variant="ghost" onClick={() => setQuickRange("today")}>Hoy</Button>
                            <Button size="sm" variant="ghost" onClick={() => setQuickRange("week")}>Esta semana</Button>
                            <Button size="sm" variant="ghost" onClick={() => setQuickRange("biweek")}>Quincena</Button>
                            <Button size="sm" variant="ghost" onClick={() => setQuickRange("month")}>Mes actual</Button>
                            <Button size="sm" variant="ghost" onClick={() => setQuickRange("lastMonth")}>Mes anterior</Button>
                            <Button size="sm" variant="ghost" onClick={() => setQuickRange("90d")}>Últimos 90 días</Button>
                          </div>
                          <Calendar
                            mode="range"
                            selected={range}
                            onSelect={setRange}
                            numberOfMonths={2}
                            locale={es}
                            className={cn("p-3 pointer-events-auto")}
                            disabled={(d) => d > new Date()}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Miembro</Label>
                      <Select value={filterMember} onValueChange={setFilterMember}>
                        <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-popover">
                          <SelectItem value="all">Todos los miembros</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.full_name || m.email || m.id.slice(0, 8)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Acción</Label>
                      <Select value={filterAction} onValueChange={setFilterAction}>
                        <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-popover">
                          <SelectItem value="all">Todas</SelectItem>
                          <SelectItem value="VALIDACION_CLAUDE">Validación IA</SelectItem>
                          <SelectItem value="OCR_DOCUMENTO">OCR documento</SelectItem>
                          <SelectItem value="APERTURA_EXPEDIENTE">Apertura expediente</SelectItem>
                          <SelectItem value="GENERACION_DOCX">Generación Word</SelectItem>
                          <SelectItem value="LEGACY">Legado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button variant="outline" className="h-9 gap-2 ml-auto" onClick={exportCsv} disabled={!filteredConsumption.length}>
                      <Download className="h-4 w-4" /> Exportar CSV
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Table */}
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[150px]">Fecha</TableHead>
                        <TableHead>Miembro</TableHead>
                        <TableHead>Acción</TableHead>
                        <TableHead>Tipo de acto</TableHead>
                        <TableHead className="text-right">Créditos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingCons ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Cargando…</TableCell></TableRow>
                      ) : filteredConsumption.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Sin movimientos en el rango seleccionado.</TableCell></TableRow>
                      ) : (
                        filteredConsumption.map((c) => {
                          const m = memberById.get(c.user_id);
                          return (
                            <TableRow key={c.id}>
                              <TableCell className="text-xs text-muted-foreground">
                                {format(new Date(c.created_at), "dd MMM yyyy HH:mm", { locale: es })}
                              </TableCell>
                              <TableCell className="text-sm">{m?.full_name || m?.email || c.user_id.slice(0, 8)}</TableCell>
                              <TableCell><Badge variant="outline">{actionLabels[c.action] ?? c.action}</Badge></TableCell>
                              <TableCell className="text-sm capitalize">{c.tipo_acto ?? "—"}</TableCell>
                              <TableCell className="text-right font-semibold">{c.credits}</TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
};

export default Team;
