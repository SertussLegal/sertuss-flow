import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useModules } from "@/contexts/ModuleContext";
import { useToast } from "@/hooks/use-toast";
import { isSuperAdmin } from "@/lib/superAdmin";
import { Save, Loader2, Puzzle, Users, ShieldAlert, Eye, EyeOff, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const NIT_REGEX = /^\d{9}-\d{1}$/;

interface ModuleRow {
  slug: string;
  name: string;
  description: string | null;
  is_core: boolean;
  enabled: boolean;
}

const AdminOrgEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile, loading: authLoading, activeOrgId } = useAuth();
  const { refreshModules } = useModules();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [nit, setNit] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nitError, setNitError] = useState("");

  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [modulesLoading, setModulesLoading] = useState(true);
  const [togglingSlug, setTogglingSlug] = useState<string | null>(null);

  // Usuarios de la organización (sólo SuperAdmin)
  interface OrgUser {
    user_id: string;
    email: string;
    full_name: string | null;
    role: "owner" | "admin" | "operator";
    is_personal: boolean;
    joined_at: string;
    last_sign_in_at: string | null;
  }
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [revealedEmails, setRevealedEmails] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isAllowed = isSuperAdmin(profile?.email);

  useEffect(() => {
    // Esperamos a que el perfil esté hidratado: sin esta guarda, el primer render
    // post-login tiene `profile === null` y dispararía un rebote a /escrituras
    // incluso siendo SuperAdmin (race con AuthContext).
    if (!authLoading && profile && !isAllowed) {
      navigate("/escrituras", { replace: true });
    }
  }, [authLoading, profile, isAllowed, navigate]);

  const loadModules = async (orgId: string) => {
    setModulesLoading(true);
    const [{ data: catalog, error: catErr }, { data: orgMods, error: omErr }] = await Promise.all([
      supabase.from("modules" as any).select("slug, name, description, is_core").order("name"),
      supabase
        .from("organization_modules" as any)
        .select("module_slug, enabled")
        .eq("organization_id", orgId),
    ]);
    if (catErr || omErr) {
      toast({
        title: "Error",
        description: (catErr ?? omErr)?.message ?? "No se pudieron cargar los módulos",
        variant: "destructive",
      });
      setModules([]);
      setModulesLoading(false);
      return;
    }
    const enabledMap = new Map<string, boolean>(
      ((orgMods ?? []) as any[]).map((r) => [r.module_slug, !!r.enabled]),
    );
    const merged: ModuleRow[] = ((catalog ?? []) as any[]).map((m) => ({
      slug: m.slug,
      name: m.name,
      description: m.description ?? null,
      is_core: !!m.is_core,
      enabled: enabledMap.get(m.slug) ?? false,
    }));
    setModules(merged);
    setModulesLoading(false);
  };

  const loadUsers = async (orgId: string) => {
    setUsersLoading(true);
    const { data, error } = await supabase.rpc("admin_list_org_users" as any, { p_org_id: orgId });
    if (error) {
      toast({ title: "Error al cargar usuarios", description: error.message, variant: "destructive" });
      setUsers([]);
    } else {
      setUsers((data as any as OrgUser[]) ?? []);
    }
    setUsersLoading(false);
  };

  // Cleanup de timeout del portapapeles al desmontar
  useEffect(() => {
    return () => setCopiedId(null);
  }, []);

  const toggleReveal = (uid: string) => {
    setRevealedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const handleCopyEmail = async (uid: string, email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedId(uid);
      window.setTimeout(() => {
        setCopiedId((curr) => (curr === uid ? null : curr));
      }, 2000);
    } catch {
      toast({ title: "Error", description: "No se pudo copiar el correo", variant: "destructive" });
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("es-CO", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  };

  const roleBadge = (r: OrgUser["role"]) => {
    if (r === "owner") return <Badge className="bg-notarial-gold/15 text-notarial-gold border-notarial-gold/30" variant="outline">Owner</Badge>;
    if (r === "admin") return <Badge className="bg-notarial-blue/15 text-notarial-blue border-notarial-blue/30" variant="outline">Admin</Badge>;
    return <Badge variant="outline">Operator</Badge>;
  };

  useEffect(() => {
    if (isAllowed && id) {
      (async () => {
        const { data, error } = await supabase.rpc("get_all_organizations" as any);
        if (error) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
          navigate("/admin");
          return;
        }
        const org = (data as any[])?.find((o: any) => o.id === id);
        if (!org) {
          toast({ title: "Error", description: "Organización no encontrada", variant: "destructive" });
          navigate("/admin");
          return;
        }
        setName(org.name ?? "");
        setNit(org.nit ?? "");
        setAddress(org.address ?? "");
        setLoading(false);
        await loadModules(id);
        await loadUsers(id);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, id]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Error", description: "La Razón Social es obligatoria", variant: "destructive" });
      return;
    }
    if (nit.trim() && !NIT_REGEX.test(nit.trim())) {
      setNitError("Formato inválido. Ej: 123456789-0");
      return;
    }
    setNitError("");
    setSaving(true);
    const { error } = await supabase.rpc("admin_update_organization" as any, {
      target_org_id: id,
      new_name: name.trim(),
      new_nit: nit.trim() || null,
      new_address: address.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Guardado", description: "Datos de la entidad actualizados correctamente" });
      navigate("/admin");
    }
  };

  const handleToggleModule = async (slug: string, next: boolean) => {
    if (!id) return;
    setTogglingSlug(slug);
    setModules((prev) => prev.map((m) => (m.slug === slug ? { ...m, enabled: next } : m)));
    const { error } = await supabase.rpc("admin_toggle_module" as any, {
      p_org_id: id,
      p_slug: slug,
      p_enabled: next,
    });
    if (error) {
      setModules((prev) => prev.map((m) => (m.slug === slug ? { ...m, enabled: !next } : m)));
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: next ? "Módulo activado" : "Módulo desactivado",
        description: `${slug} · cambio registrado en activity_logs`,
      });
    }
    setTogglingSlug(null);
  };

  if (authLoading || !profile || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAllowed) return null;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <main className="container max-w-xl py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Datos Legales de la Entidad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Razón Social <span className="text-destructive">*</span></Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre legal de la entidad" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nit">NIT</Label>
              <Input id="nit" value={nit} onChange={(e) => { setNit(e.target.value); setNitError(""); }} placeholder="123456789-0" />
              {nitError && <p className="text-sm text-destructive">{nitError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Dirección</Label>
              <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Dirección de la entidad" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => navigate("/admin")}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving || !name.trim()}>
                <Save className="mr-1 h-4 w-4" />
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Puzzle className="h-4 w-4 text-notarial-blue" />
              Módulos Habilitados
            </CardTitle>
            <CardDescription>
              Activa o desactiva las secciones visibles para esta organización. Los cambios se aplican
              en cuanto el usuario recarga la app y quedan registrados en el log de actividad.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {modulesLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Cargando módulos…
              </div>
            ) : modules.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No hay módulos disponibles en el catálogo.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {modules.map((m) => {
                  const isToggling = togglingSlug === m.slug;
                  return (
                    <li key={m.slug} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{m.name}</span>
                          {m.is_core && (
                            <span className="rounded bg-notarial-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-notarial-gold">
                              Core
                            </span>
                          )}
                          <code className="text-[10px] text-muted-foreground">{m.slug}</code>
                        </div>
                        {m.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {m.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isToggling && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        <Switch
                          checked={m.enabled}
                          disabled={isToggling}
                          onCheckedChange={(next) => handleToggleModule(m.slug, next)}
                          aria-label={`Activar módulo ${m.name}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-notarial-blue" />
              Usuarios de la organización
            </CardTitle>
            <CardDescription>
              Listado de personas con acceso a esta entidad. Visible únicamente para el SuperAdmin.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-notarial-gold/30 bg-notarial-gold/10 px-3 py-2 text-xs text-notarial-gold">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                <strong>Acceso auditado (Ley 1581 de 2012).</strong> Cada visualización de correos queda
                registrada en el log de actividad con tu identidad y la dirección IP de origen.
              </p>
            </div>

            {usersLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Cargando usuarios…
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No hay miembros asociados a esta organización.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Correo</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Ingresó</TableHead>
                      <TableHead>Último acceso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => {
                      const revealed = revealedEmails.has(u.user_id);
                      const copied = copiedId === u.user_id;
                      return (
                        <TableRow key={u.user_id}>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-mono text-xs transition-all duration-200 ${
                                  revealed ? "" : "blur-sm select-none"
                                }`}
                              >
                                {u.email}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => toggleReveal(u.user_id)}
                                aria-label={revealed ? "Ocultar correo" : "Mostrar correo"}
                              >
                                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => handleCopyEmail(u.user_id, u.email)}
                                aria-label="Copiar correo"
                              >
                                {copied ? (
                                  <Check className="h-3.5 w-3.5 text-notarial-green" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">{u.full_name ?? "—"}</TableCell>
                          <TableCell>{roleBadge(u.role)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {u.is_personal ? "Personal" : "Compartida"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(u.joined_at)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(u.last_sign_in_at)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AdminOrgEdit;
