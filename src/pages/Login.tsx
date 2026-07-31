import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Scale, Shield, Zap, ShieldCheck } from "lucide-react";

const formatNit = (value: string): string => {
  const digits = value.replace(/[^\d]/g, "").slice(0, 10);
  if (digits.length > 9) {
    return digits.slice(0, 9) + "-" + digits.slice(9);
  }
  return digits;
};

const FEATURES = [
  {
    icon: Zap,
    title: "Extracción automática",
    description: "Certificados, escrituras y poderes, leídos y estructurados en segundos.",
  },
  {
    icon: ShieldCheck,
    title: "Validación rigurosa",
    description: "Cada dato se contrasta antes de llegar al documento final.",
  },
  {
    icon: Scale,
    title: "El criterio humano manda",
    description: "La IA propone; el profesional del derecho siempre decide.",
  },
];

const TURNSTILE_SITE_KEY = "0x4AAAAAAEDBKFp8VFyTZQ7n";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
    };
  }
}

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [nit, setNit] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot anti-bot — invisible para humanos
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  // Same-origin relative path only; ignore anything else.
  const rawNext = searchParams.get("next") ?? "";
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const renderWidget = () => {
      if (window.turnstile && turnstileRef.current && !widgetIdRef.current) {
        widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => setCaptchaToken(token),
          "expired-callback": () => setCaptchaToken(null),
          "error-callback": () => setCaptchaToken(null),
        });
      }
    };
    if (window.turnstile) {
      renderWidget();
    } else {
      interval = setInterval(() => {
        if (window.turnstile) {
          if (interval) clearInterval(interval);
          renderWidget();
        }
      }, 200);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  const handleNitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNit(formatNit(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (website.trim() !== "") {
      // Honeypot activado: salida silenciosa, sin llamar a supabase ni mostrar error.
      return;
    }
    if (!captchaToken) {
      toast({ title: "Verificación requerida", description: "Completa la verificación de seguridad antes de continuar.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      if (isRegister) {
        if (!fullName.trim() || fullName.trim().length < 3) {
          toast({ title: "Error", description: "El nombre completo es obligatorio (mínimo 3 caracteres).", variant: "destructive" });
          setLoading(false);
          return;
        }
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

        // La verificación de Turnstile y el signUp real ahora ocurren dentro
        // de la edge function auth-captcha-proxy, del lado del servidor.
        const { data: fnData, error: fnError } = await supabase.functions.invoke("auth-captcha-proxy", {
          body: {
            action: "signup",
            email,
            password,
            captchaToken,
            fullName: fullName.trim(),
            orgName: orgName.trim(),
            nit: nit.trim(),
            emailRedirectTo: `${window.location.origin}${nextPath}`,
          },
        });
        if (fnError) throw fnError;
        if (fnData?.error) throw new Error(fnData.error.message);

        toast({ title: "Registro exitoso", description: "Revisa tu correo para confirmar tu cuenta." });
      } else {
        const { data: fnData, error: fnError } = await supabase.functions.invoke("auth-captcha-proxy", {
          body: { action: "signin", email, password, captchaToken },
        });
        if (fnError) throw fnError;
        if (fnData?.error) throw new Error(fnData.error.message);

        if (fnData?.session) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: fnData.session.access_token,
            refresh_token: fnData.session.refresh_token,
          });
          if (setSessionError) throw setSessionError;
        }
        navigate(nextPath);
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
      }
      setCaptchaToken(null);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-notarial-dark p-4 sm:p-6 lg:p-10">
      {/* Blobs difuminados de fondo */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-notarial-blue/20 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[26rem] w-[26rem] rounded-full bg-notarial-gold/10 blur-3xl" />
        <div className="absolute -right-24 top-1/3 h-[30rem] w-[30rem] rounded-full bg-notarial-blue/15 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col items-center justify-center gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
        {/* Columna izquierda — marca */}
        <div className="w-full max-w-xl space-y-8 text-center lg:text-left">
          <div className="flex items-center justify-center gap-2 lg:justify-start">
            <Scale className="h-9 w-9 text-notarial-gold" />
            <Shield className="h-7 w-7 text-notarial-green" />
            <span className="text-2xl font-bold tracking-tight text-notarial-light">Sertuss</span>
          </div>

          <div className="space-y-4">
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-notarial-light sm:text-4xl lg:text-5xl">
              Inteligencia documental para el sector notarial.
            </h1>
            <p className="text-base text-muted-foreground sm:text-lg">
              Sertuss lee, valida y redacta instrumentos notariales con inteligencia artificial — reduce horas de trabajo repetitivo a minutos, sin ceder el criterio jurídico que cada trámite exige.
            </p>
          </div>

          <ul className="hidden space-y-5 lg:block">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-notarial-gold/25 bg-notarial-blue/20">
                  <Icon className="h-5 w-5 text-notarial-gold" aria-hidden />
                </span>
                <div className="space-y-1">
                  <p className="font-semibold text-notarial-light">{title}</p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Columna derecha — tarjeta de login */}
        <div className="w-full max-w-md">
          <Card className="border-notarial-blue/30 bg-card/95 shadow-2xl backdrop-blur">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{isRegister ? "Crear Cuenta" : "Iniciar Sesión"}</CardTitle>
              <CardDescription>
                {isRegister ? "Registra tu cuenta y organización" : "Ingresa tus credenciales"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div
                  style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
                  aria-hidden="true"
                >
                  <Label htmlFor="website">Sitio web</Label>
                  <Input
                    id="website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>
                {isRegister && (
                  <fieldset className="space-y-4 rounded-md border border-border p-4">
                    <legend className="px-2 text-sm font-semibold text-foreground">Datos Legales</legend>
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Nombre completo</Label>
                      <Input
                        id="fullName"
                        placeholder="Tu nombre y apellidos"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        minLength={3}
                      />
                      <p className="text-xs text-muted-foreground">Aparecerá en el registro de auditoría de créditos.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="orgName">Razón Social</Label>
                      <Input
                        id="orgName"
                        placeholder="Nombre legal de la Notaría, Firma o Empresa"
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nit">NIT</Label>
                      <Input
                        id="nit"
                        placeholder="000000000-0"
                        value={nit}
                        onChange={handleNitChange}
                        maxLength={11}
                        required
                      />
                      <p className="text-xs text-muted-foreground">Formato: XXXXXXXXX-X</p>
                    </div>
                  </fieldset>
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
                    minLength={isRegister ? 8 : undefined}
                  />
                  {isRegister && (
                    <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
                  )}
                </div>
                <div ref={turnstileRef} className="flex justify-center" />
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
    </div>
  );
};

export default Login;
