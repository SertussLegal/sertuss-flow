import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { isSuperAdmin } from "@/lib/superAdmin";
import { Save } from "lucide-react";

const NIT_REGEX = /^\d{9}-\d{1}$/;

const AdminOrgEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [nit, setNit] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nitError, setNitError] = useState("");

  const isAllowed = isSuperAdmin(profile?.email);

  useEffect(() => {
    if (!authLoading && !isAllowed) {
      navigate("/escrituras", { replace: true });
    }
  }, [authLoading, isAllowed, navigate]);

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
      })();
    }
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

  if (authLoading || loading || !isAllowed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="bg-background">
      <main className="container max-w-xl py-8">
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
      </main>
    </div>
  );
};

export default AdminOrgEdit;
