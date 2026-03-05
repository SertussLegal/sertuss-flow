import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Scale,
  Shield,
  Lock,
  Building2,
  Cloud,
  ArrowRight,
  Play,
} from "lucide-react";
import DemoModal from "@/components/landing/DemoModal";

const LandingPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedPolicy) return;
    setLoading(true);
    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast({
          title: "Registro exitoso",
          description: "Revisa tu correo para confirmar tu cuenta.",
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-dark">
      {/* Header */}
      <header className="border-b border-border/20 px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-7 w-7 text-notarial-gold" aria-hidden="true" />
            <span className="text-xl font-bold text-slate-100">Sertuss</span>
          </div>
          <nav aria-label="Navegación principal">
            <Button
              variant="outline"
              className="min-h-[44px] border-white/20 text-white hover:bg-white/10 hover:text-white"
              onClick={() => {
                document
                  .getElementById("hero-form")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
              aria-label="Ir a iniciar sesión"
            >
              Iniciar Sesión
            </Button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero Split-Screen */}
        <section
          className="px-4 py-20 sm:px-6 sm:py-32 lg:px-8"
          aria-label="Sección principal"
        >
          <div className="mx-auto grid max-w-[1200px] items-center gap-16 lg:grid-cols-2 lg:gap-24">
            {/* Left: Copy */}
            <div className="animate-fade-in-up space-y-8">
              <h1 className="text-4xl font-semibold leading-[1.2] tracking-tight text-notarial-light sm:text-5xl lg:text-[4.5rem]">
                Agilidad y Precisión en tu Operación Notarial.
              </h1>
              <p className="max-w-lg text-lg leading-relaxed text-slate-300">
                Optimiza el diligenciamiento de formatos con inteligencia
                documental. Sertuss es el aliado de tu equipo legal para
                procesar minutas con la velocidad y exactitud que el sector
                exige.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button
                  size="lg"
                  className="min-h-[44px] min-w-[44px] rounded-lg bg-notarial-green py-4 px-8 text-secondary-foreground shadow-lg shadow-emerald-500/20 hover:bg-notarial-green/90"
                  onClick={() => {
                    setIsRegister(true);
                    document
                      .getElementById("hero-form")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                  aria-label="Registrarse para cargar la primera minuta"
                >
                  Empezar ahora
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="min-h-[44px] min-w-[44px] rounded-lg border-white/20 py-4 px-8 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => setDemoOpen(true)}
                  aria-label="Ver demostración en video"
                >
                  <Play className="mr-1 h-4 w-4" aria-hidden="true" />
                  Ver Demo
                </Button>
              </div>
            </div>

            {/* Right: Auth Form (Glassmorphism) */}
            <div id="hero-form" className="flex items-start justify-center lg:justify-end">
              <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.05] p-6 shadow-2xl backdrop-blur-2xl">
                <div className="mb-4 text-center">
                  <div className="mx-auto mb-2 flex items-center gap-2">
                    <Scale
                      className="h-8 w-8 text-notarial-gold"
                      aria-hidden="true"
                    />
                    <Shield
                      className="h-6 w-6 text-notarial-green"
                      aria-hidden="true"
                    />
                  </div>
                  <h2 className="text-xl font-semibold text-white">
                    {isRegister ? "Crear Cuenta" : "Iniciar Sesión"}
                  </h2>
                  <p className="text-sm text-slate-300">
                    {isRegister
                      ? "Registra tu cuenta para acceder al sistema"
                      : "Ingresa tus credenciales"}
                  </p>
                </div>
                <div>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-white">
                        Correo electrónico
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="correo@ejemplo.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="h-12 border-white/10 bg-white/10 text-white placeholder:text-slate-400"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password" className="text-white">
                        Contraseña
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={6}
                        className="h-12 border-white/10 bg-white/10 text-white placeholder:text-slate-400"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="min-h-[44px] w-full rounded-lg bg-notarial-green py-4 px-8 text-secondary-foreground shadow-lg shadow-emerald-500/20 hover:bg-notarial-green/90"
                      disabled={loading || !acceptedPolicy}
                    >
                      {loading
                        ? "Procesando..."
                        : isRegister
                          ? "Registrarse"
                          : "Ingresar"}
                    </Button>
                    <div className="flex items-start gap-2 pt-2">
                      <Checkbox
                        id="policy"
                        checked={acceptedPolicy}
                        onCheckedChange={(v) => setAcceptedPolicy(v === true)}
                        className="mt-0.5 border-white data-[state=checked]:bg-notarial-green data-[state=checked]:border-notarial-green"
                        aria-label="Aceptar política de tratamiento de datos"
                      />
                      <Label
                        htmlFor="policy"
                        className="text-xs leading-snug text-white cursor-pointer"
                      >
                        Acepto la{" "}
                        <a
                          href="#"
                          className="text-white underline underline-offset-2 hover:text-notarial-gold"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Política de Tratamiento de Datos (Ley 1581)
                        </a>
                      </Label>
                    </div>
                  </form>
                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => setIsRegister(!isRegister)}
                      className="min-h-[44px] text-sm text-slate-300 underline-offset-4 hover:text-white hover:underline"
                    >
                      {isRegister
                        ? "¿Ya tienes cuenta? Inicia sesión"
                        : "¿No tienes cuenta? Regístrate"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        {/* Trust Signals */}
        <section
          className="border-y border-white/10 bg-white/[0.02] px-4 py-20 sm:px-6 lg:px-8"
          aria-label="Señales de confianza"
        >
          <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="flex items-center gap-3 justify-center">
              <Lock
                className="h-6 w-6 shrink-0 text-notarial-gold"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-white">
                Seguridad Institucional
              </span>
            </div>
            <div className="flex items-center gap-3 justify-center">
              <Building2
                className="h-6 w-6 shrink-0 text-notarial-green"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-white">
                Alineado con estándares SNR
              </span>
            </div>
            <div className="flex items-center gap-3 justify-center">
              <Cloud
                className="h-6 w-6 shrink-0 text-notarial-blue"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-white">
                Infraestructura de Alta Disponibilidad
              </span>
            </div>
          </div>
        </section>

        {/* FAQ Estructurada */}
        <section
          className="bg-white/[0.02] px-4 py-20 sm:py-32 sm:px-6 lg:px-8"
          aria-label="Preguntas frecuentes"
          itemScope
          itemType="https://schema.org/FAQPage"
        >
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-10 text-center text-2xl font-semibold text-white sm:text-3xl">
              Preguntas Frecuentes
            </h2>
            <Accordion type="single" collapsible className="space-y-2">
              <div
                itemScope
                itemProp="mainEntity"
                itemType="https://schema.org/Question"
              >
                <AccordionItem
                  value="q1"
                  className="rounded-lg border-border/30 bg-card/10 px-4"
                >
             <AccordionTrigger className="text-left text-white hover:no-underline">
                    <span itemProp="name">
                      ¿Cómo automatizar minutas del Banco de Bogotá?
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div
                      itemScope
                      itemProp="acceptedAnswer"
                      itemType="https://schema.org/Answer"
                    >
                       <p
                        itemProp="text"
                        className="leading-relaxed text-muted-foreground"
                      >
                        Sertuss integra algoritmos que extraen datos de pagarés, instrucciones y certificados del Banco de Bogotá en segundos. El abogado se enfoca en la validación jurídica mientras el sistema genera la minuta en Word lista para firma.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </div>

              <div
                itemScope
                itemProp="mainEntity"
                itemType="https://schema.org/Question"
              >
                <AccordionItem
                  value="q2"
                  className="rounded-lg border-white/10 bg-white/[0.03] px-4"
                >
                  <AccordionTrigger className="text-left text-white hover:no-underline">
                    <span itemProp="name">
                      ¿Cómo evitar errores de registro en escrituras?
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div
                      itemScope
                      itemProp="acceptedAnswer"
                      itemType="https://schema.org/Answer"
                    >
                      <p
                        itemProp="text"
                        className="leading-relaxed text-muted-foreground"
                      >
                        El motor de validación cruza matrícula, linderos, CHIP y datos de las partes contra el certificado de tradición en tiempo real. Detecta inconsistencias antes de la escritura, eliminando notas devolutivas de la ORIP.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </div>
            </Accordion>
          </div>
        </section>
      </main>

      {/* Footer Legal */}
      <footer className="border-t border-border/20 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <p className="text-xs text-slate-400">
              © {new Date().getFullYear()} Sertuss. Todos los derechos
              reservados.
            </p>
            <nav className="flex gap-6" aria-label="Enlaces legales">
              <a
                href="#"
                className="min-h-[44px] flex items-center text-xs text-slate-400 underline-offset-4 hover:text-white hover:underline"
              >
                Política de Tratamiento de Datos (Habeas Data)
              </a>
              <a
                href="#"
                className="min-h-[44px] flex items-center text-xs text-slate-400 underline-offset-4 hover:text-white hover:underline"
              >
                Términos de Servicio
              </a>
            </nav>
          </div>
        </div>
      </footer>

      {/* Demo Modal */}
      <DemoModal open={demoOpen} onOpenChange={setDemoOpen} />
    </div>
  );
};

export default LandingPage;
