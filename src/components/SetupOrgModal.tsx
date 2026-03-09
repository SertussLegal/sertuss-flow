import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const formatNit = (value: string): string => {
  const digits = value.replace(/[^\d]/g, "").slice(0, 10);
  if (digits.length > 9) {
    return digits.slice(0, 9) + "-" + digits.slice(9);
  }
  return digits;
};

interface SetupOrgModalProps {
  open: boolean;
  userId: string;
  onComplete: () => void;
}

const SetupOrgModal = ({ open, userId, onComplete }: SetupOrgModalProps) => {
  const [orgName, setOrgName] = useState("");
  const [nit, setNit] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleNitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNit(formatNit(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nitRegex = /^\d{9}-\d{1}$/;
    if (nit.trim() && !nitRegex.test(nit.trim())) {
      toast({ title: "Error", description: "El NIT debe tener el formato XXXXXXXXX-X.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc("create_organization_for_user", {
        p_user_id: userId,
        p_org_name: orgName.trim() || "Organizacion001",
        p_org_nit: nit.trim(),
      });
      if (error) throw error;

      toast({ title: "¡Listo!", description: "Tu organización ha sido creada." });
      onComplete();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Configura tu organización</DialogTitle>
          <DialogDescription>
            Para continuar, completa los datos legales de tu organización. Si no tienes los datos ahora, puedes dejar el nombre en blanco y se asignará uno genérico.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="setup-orgName">Razón Social</Label>
            <Input
              id="setup-orgName"
              placeholder="Nombre legal (opcional, default: Organizacion001)"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-nit">NIT</Label>
            <Input
              id="setup-nit"
              placeholder="000000000-0"
              value={nit}
              onChange={handleNitChange}
              maxLength={11}
            />
            <p className="text-xs text-muted-foreground">Formato: XXXXXXXXX-X (opcional)</p>
          </div>
          <Button type="submit" className="w-full bg-notarial-blue hover:bg-notarial-blue/90" disabled={loading}>
            {loading ? "Creando..." : "Crear Organización"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SetupOrgModal;
