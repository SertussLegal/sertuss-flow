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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Scale,
  Shield,
  FileCheck,
  Cloud,
  CheckCircle,
  ArrowRight,
  Play,
  Lock,
  Building2,
} from "lucide-react";
import DemoModal from "@/components/landing/DemoModal";

const LandingPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    <div className="min-h-screen bg-notarial-dark">
      {/* Header */}
      <header className="border-b border-border/20 px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-7 w-7 text-notarial-gold" aria-hidden="true" />
            <span className="text-xl font-bold text-white">Sertuss</span>
          </div>
          <nav aria-label="Navegación principal">
            <Button
              variant="ghost"
              className="min-h-[44px] text-muted-foreground hover:text-white"
              onClick={() => {
                document
                  .getElementById("auth-section")
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
          className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
          aria-label="Sección principal"
        >
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
            {/* Left: Copy */}
            <div className="space-y-6">
              <h1 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">
                Escrituración Inteligente en Colombia.{" "}
                <span className="text-notarial-green">
                  Cero Notas Devolutivas.
                </span>
              </h1>
              <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
                Llenar minutas en Word manualmente es un riesgo. Sertuss usa IA
                para extraer datos de cédulas y certificados con precisión
                registral, eliminando errores antes de que lleguen a la ORIP.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button
                  size="lg"
                  className="min-h-[44px] min-w-[44px] bg-notarial-green text-white hover:bg-notarial-green/90"
                  onClick={() => {
                    setIsRegister(true);
                    document
                      .getElementById("auth-section")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                  aria-label="Registrarse para cargar la primera minuta"
                >
                  Cargar mi primera Minuta
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="min-h-[44px] min-w-[44px] border-border/40 text-muted-foreground hover:bg-accent hover:text-white"
                  onClick={() => setDemoOpen(true)}
                  aria-label="Ver demostración en video"
                >
                  <Play className="mr-1 h-4 w-4" aria-hidden="true" />
                  Ver Demo
                </Button>
              </div>
            </div>

            {/* Right: Visual */}
            <div
              className="flex items-center justify-center"
              aria-hidden="true"
            >
              <div className="relative w-full max-w-md">
                <div className="rounded-2xl border border-border/30 bg-card/50 p-8 backdrop-blur">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-notarial-blue/20">
                        <FileCheck className="h-5 w-5 text-notarial-blue" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          Certificado de Tradición
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Datos extraídos automáticamente
                        </p>
                      </div>
                      <CheckCircle className="ml-auto h-5 w-5 text-notarial-green" />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-notarial-green/20">
                        <Shield className="h-5 w-5 text-notarial-green" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          Validación SARLAFT
                        </p>
                        <p className="text-xs text-muted-foreground">
                          PEP verificado
                        </p>
                      </div>
                      <CheckCircle className="ml-auto h-5 w-5 text-notarial-green" />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-notarial-gold/20">
                        <Scale className="h-5 w-5 text-notarial-gold" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          Minuta Generada
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Lista para firma — 0 errores
                        </p>
                      </div>
                      <CheckCircle className="ml-auto h-5 w-5 text-notarial-green" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust Signals */}
        <section
          className="border-y border-border/20 bg-card/30 px-4 py-10 sm:px-6 lg:px-8"
          aria-label="Señales de confianza"
        >
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="flex items-center gap-3 justify-center">
              <Lock
                className="h-6 w-6 shrink-0 text-notarial-gold"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-white">
                Seguridad de Grado Bancario
              </span>
            </div>
            <div className="flex items-center gap-3 justify-center">
              <Building2
                className="h-6 w-6 shrink-0 text-notarial-green"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-white">
                Cumple con SNR
              </span>
            </div>
            <div className="flex items-center gap-3 justify-center">
              <Cloud
                className="h-6 w-6 shrink-0 text-notarial-blue"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-white">
                Infraestructura Google Cloud
              </span>
            </div>
          </div>
        </section>

        {/* FAQ Estructurada */}
        <section
          className="px-4 py-16 sm:px-6 lg:px-8"
          aria-label="Preguntas frecuentes"
          itemScope
          itemType="https://schema.org/FAQPage"
        >
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-8 text-center text-2xl font-bold text-white">
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
                  className="rounded-lg border-border/30 bg-card/50 px-4"
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
                        Sertuss permite cargar los documentos del Banco de
                        Bogotá (pagarés, instrucciones notariales, certificados)
                        y extrae automáticamente los datos del comprador,
                        vendedor, inmueble e hipoteca. La minuta se genera en
                        formato Word lista para firma, eliminando errores
                        manuales y notas devolutivas de la ORIP.
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
                  className="rounded-lg border-border/30 bg-card/50 px-4"
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
                        Sertuss valida automáticamente los datos contra el
                        certificado de tradición: matrícula inmobiliaria,
                        linderos, identificadores prediales (CHIP o Número
                        Predial Nacional) y datos de las partes. El sistema
                        detecta inconsistencias antes de generar la escritura,
                        reduciendo a cero las notas devolutivas de la Oficina de
                        Registro.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </div>
            </Accordion>
          </div>
        </section>

        {/* Auth Section */}
        <section
          id="auth-section"
          className="px-4 py-16 sm:px-6 lg:px-8"
          aria-label="Autenticación"
        >
          <div className="mx-auto max-w-md space-y-6">
            <Card className="border-notarial-blue/30 bg-card/95 shadow-2xl backdrop-blur">
              <CardHeader className="text-center">
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
                <CardTitle className="text-xl">
                  {isRegister ? "Crear Cuenta" : "Iniciar Sesión"}
                </CardTitle>
                <CardDescription>
                  {isRegister
                    ? "Registra tu cuenta para acceder al sistema"
                    : "Ingresa tus credenciales"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
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
                  <Button
                    type="submit"
                    className="min-h-[44px] w-full bg-notarial-blue hover:bg-notarial-blue/90"
                    disabled={loading}
                  >
                    {loading
                      ? "Procesando..."
                      : isRegister
                        ? "Registrarse"
                        : "Ingresar"}
                  </Button>
                </form>
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => setIsRegister(!isRegister)}
                    className="min-h-[44px] text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {isRegister
                      ? "¿Ya tienes cuenta? Inicia sesión"
                      : "¿No tienes cuenta? Regístrate"}
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer Legal */}
      <footer className="border-t border-border/20 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Sertuss. Todos los derechos
              reservados.
            </p>
            <nav
              className="flex gap-6"
              aria-label="Enlaces legales"
            >
              <a
                href="#"
                className="min-h-[44px] flex items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Política de Tratamiento de Datos (Habeas Data)
              </a>
              <a
                href="#"
                className="min-h-[44px] flex items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
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
