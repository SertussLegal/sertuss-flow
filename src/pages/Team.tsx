import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Scale, UserPlus, Users } from "lucide-react";

const Team = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile, organization, credits } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("operator");
  const [loading, setLoading] = useState(false);

  const isAdminOrOwner = profile?.role === "owner" || profile?.role === "admin";

  useEffect(() => {
    if (profile?.organization_id) {
      fetchMembers();
    }
  }, [profile?.organization_id]);

  const fetchMembers = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("organization_id", profile!.organization_id!);
    if (data) setMembers(data);
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

  const roleLabels: Record<string, string> = {
    owner: "Propietario",
    admin: "Administrador",
    operator: "Operador",
  };

  return (
    <div className="min-h-screen bg-background">
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
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="text-white hover:bg-white/10">
              <ArrowLeft className="mr-1 h-4 w-4" /> Dashboard
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Gestión de Equipo</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Organización: <strong>{organization?.name ?? "—"}</strong>
        </p>

        {/* Members table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Miembros</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Correo</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Rol</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>{m.full_name || "—"}</TableCell>
                    <TableCell>
                      {isAdminOrOwner && m.id !== profile?.id ? (
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

        {/* Invite form */}
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
      </main>
    </div>
  );
};

export default Team;
