import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Scale, Shield } from "lucide-react";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [nit, setNit] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister) {
        if (!orgName.trim()) {
          toast({ title: "Error", description: "La Razón Social es obligatoria.", variant: "destructive" });
          setLoading(false);
          return;
        }
        const nitRegex = /^\d{9}-\d{1}$/;
        if (!nitRegex.test(nit.trim())) {
          toast({ title: "Error", description: "El NIT debe tener el formato XXXXXXXXX-X (9 dígitos, guión, 1 dígito).", variant: "destructive" });
          setLoading(false);
          return;
        }
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;

        if (signUpData.user) {
          // Create organization
          const { data: org, error: orgError } = await supabase
            .from("organizations")
            .insert({ name: orgName.trim(), nit: nit.trim() })
            .select()
            .single();
          if (orgError) throw orgError;

          // Update profile with org + owner role
          const { error: profileError } = await supabase
            .from("profiles")
            .update({ organization_id: org.id, role: "owner" as any })
            .eq("id", signUpData.user.id);
          if (profileError) throw profileError;
        }

        toast({ title: "Registro exitoso", description: "Revisa tu correo para confirmar tu cuenta." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-notarial-dark p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-primary-foreground">
          <div className="flex items-center gap-2">
            <Scale className="h-10 w-10 text-notarial-gold" />
            <Shield className="h-8 w-8 text-notarial-green" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Sertuss</h1>
          <p className="text-sm text-muted-foreground">Sistema de Escrituración — Colombia</p>
        </div>

        <Card className="border-notarial-blue/30 bg-card/95 shadow-2xl backdrop-blur">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{isRegister ? "Crear Cuenta" : "Iniciar Sesión"}</CardTitle>
            <CardDescription>
              {isRegister ? "Registra tu cuenta y organización" : "Ingresa tus credenciales"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="space-y-2">
                  <Label htmlFor="orgName">Nombre de la Organización / Notaría</Label>
                  <Input
                    id="orgName"
                    placeholder="Notaría 15 de Bogotá"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="correo@ejemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" className="w-full bg-notarial-blue hover:bg-notarial-blue/90" disabled={loading}>
                {loading ? "Procesando..." : isRegister ? "Registrarse" : "Ingresar"}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setIsRegister(!isRegister)}
                className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              >
                {isRegister ? "¿Ya tienes cuenta? Inicia sesión" : "¿No tienes cuenta? Regístrate"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
