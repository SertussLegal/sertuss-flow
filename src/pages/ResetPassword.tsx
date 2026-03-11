import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Scale, KeyRound } from "lucide-react";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event from the auth hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    // Also check if already in a recovery session
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setReady(true);
    }
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Error", description: "Las contraseñas no coinciden.", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Error", description: "La contraseña debe tener al menos 6 caracteres.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: "Contraseña actualizada", description: "Tu contraseña ha sido restablecida exitosamente." });
      navigate("/dashboard");
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-dark flex flex-col">
      <header className="border-b border-border/20 bg-gradient-dark px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center">
          <a href="/" className="flex items-center gap-2">
            <Scale className="h-7 w-7 text-notarial-gold" aria-hidden="true" />
            <span className="text-xl font-bold text-slate-100">Sertuss</span>
          </a>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.05] p-8 shadow-2xl backdrop-blur-2xl">
          <div className="mb-6 flex flex-col items-center gap-3">
            <KeyRound className="h-10 w-10 text-notarial-gold" />
            <h1 className="text-xl font-semibold text-white">Restablecer contraseña</h1>
            <p className="text-sm text-slate-400 text-center">Ingresa tu nueva contraseña para continuar.</p>
          </div>

          {!ready ? (
            <p className="text-center text-sm text-slate-400">
              Verificando enlace de recuperación…
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password" className="text-white">Nueva contraseña</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-12 border-white/10 bg-white/10 text-white placeholder:text-slate-400"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password" className="text-white">Confirmar contraseña</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="h-12 border-white/10 bg-white/10 text-white placeholder:text-slate-400"
                />
              </div>
              <Button
                type="submit"
                className="min-h-[44px] w-full rounded-lg bg-notarial-green py-4 px-8 text-secondary-foreground shadow-lg shadow-emerald-500/20 hover:bg-notarial-green/90"
                disabled={loading}
              >
                {loading ? "Procesando..." : "Restablecer contraseña"}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default ResetPassword;
