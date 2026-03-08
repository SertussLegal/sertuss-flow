import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Scale, ArrowLeft, Search, Building2, Coins, Pencil } from "lucide-react";

interface Org {
  id: string;
  name: string;
  nit: string | null;
  address: string | null;
  credit_balance: number;
  created_at: string;
}

const getStatusBadge = (balance: number) => {
  if (balance > 5)
    return <Badge className="bg-notarial-green/10 text-notarial-green border-notarial-green/30" variant="outline">Activo</Badge>;
  if (balance >= 1)
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300" variant="outline">Créditos Bajos</Badge>;
  return <Badge className="bg-destructive/10 text-destructive border-destructive/30" variant="outline">Agotado</Badge>;
};

const Admin = () => {
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modal state
  const [editOrg, setEditOrg] = useState<Org | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Access guard
  useEffect(() => {
    if (!authLoading && profile?.role !== "owner") {
      navigate("/dashboard", { replace: true });
    }
  }, [authLoading, profile, navigate]);

  const fetchOrgs = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_all_organizations" as any);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setOrgs((data as unknown as Org[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (profile?.role === "owner") fetchOrgs();
  }, [profile]);

  const filtered = orgs.filter(
    (o) =>
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      (o.nit ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalCredits = orgs.reduce((sum, o) => sum + o.credit_balance, 0);

  const openEditModal = (org: Org) => {
    setEditOrg(org);
    setNewBalance(String(org.credit_balance));
    setReason("");
  };

  const handleSave = async () => {
    if (!editOrg || !reason.trim()) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_update_credits" as any, {
      target_org_id: editOrg.id,
      new_balance: parseInt(newBalance, 10),
      reason: reason.trim(),
    });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Créditos actualizados", description: `${editOrg.name} → ${newBalance} créditos` });
      setEditOrg(null);
      fetchOrgs();
    }
  };

  if (authLoading || profile?.role !== "owner") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-notarial-dark text-white">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="h-6 w-6 text-notarial-gold" />
            <span className="text-lg font-bold">Sertuss</span>
            <span className="text-sm text-white/60">/ Panel de Administración</span>
          </div>
          <Button variant="ghost-dark" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Dashboard
          </Button>
        </div>
      </header>

      <main className="container py-8 space-y-6">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-notarial-blue/10">
                <Building2 className="h-6 w-6 text-notarial-blue" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Organizaciones</p>
                <p className="text-2xl font-bold">{orgs.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-notarial-gold/10">
                <Coins className="h-6 w-6 text-notarial-gold" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Créditos en Circulación</p>
                <p className="text-2xl font-bold">{totalCredits}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por razón social o NIT..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        {/* Table */}
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Razón Social</TableHead>
                  <TableHead>NIT</TableHead>
                  <TableHead>Créditos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell>{o.nit ?? "—"}</TableCell>
                    <TableCell>{o.credit_balance}</TableCell>
                    <TableCell>{getStatusBadge(o.credit_balance)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openEditModal(o)}>
                        <Pencil className="mr-1 h-3 w-3" /> Editar Créditos
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No se encontraron organizaciones</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>

      {/* Edit Credits Dialog */}
      <Dialog open={!!editOrg} onOpenChange={(open) => !open && setEditOrg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Créditos — Razón Social de la Entidad: {editOrg?.name}</DialogTitle>
            <DialogDescription>Ajusta el saldo de créditos para esta entidad. Este cambio quedará registrado en el log de auditoría.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="balance">Nuevo Saldo</Label>
              <Input id="balance" type="number" min={0} value={newBalance} onChange={(e) => setNewBalance(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Motivo del Ajuste <span className="text-destructive">*</span></Label>
              <Textarea id="reason" placeholder="Ej: Compra de paquete 100, Corrección técnica" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOrg(null)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !reason.trim()} className="bg-notarial-green hover:bg-notarial-green/90">
              {saving ? "Guardando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Admin;
