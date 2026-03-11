import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger } from
"@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Scale,
  Shield,
  Lock,
  Building2,
  ArrowRight,
  Play } from
"lucide-react";
import DemoModal from "@/components/landing/DemoModal";

const LandingPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") === "register" ? "register" : "login");
  const navigate = useNavigate();
  const { toast } = useToast();

  const isRegister = activeTab === "register";

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      toast({ title: "Ingresa tu correo", description: "Escribe tu correo electrónico para recuperar tu contraseña.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast({ title: "Correo enviado", description: "Revisa tu bandeja de entrada para restablecer tu contraseña." });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister && !acceptedPolicy) return;
    setLoading(true);
    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast({
          title: "Registro exitoso",
          description: "Revisa tu correo para confirmar tu cuenta."
        });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) throw error;
        navigate("/dashboard");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-dark">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/20 bg-gradient-dark px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-7 w-7 text-notarial-gold" aria-hidden="true" />
            <span className="text-xl font-bold text-slate-100">Sertuss</span>
          </div>
          <nav aria-label="Navegación principal">
            <Button
              variant="ghost-dark"
              className="min-h-[44px]"
              onClick={() => {
                document.
                getElementById("hero-form")?.
                scrollIntoView({ behavior: "smooth" });
              }}
              aria-label="Ir a iniciar sesión">
              
              Iniciar Sesión
            </Button>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero Split-Screen */}
        <section
          className="hero-gradient px-4 py-20 sm:px-6 sm:py-[64px] mx-0 lg:px-[32px]"
          aria-label="Sección principal">
          
          <div className="mx-auto grid max-w-[1200px] items-center gap-16 lg:grid-cols-2 lg:gap-24">
            {/* Left: Copy */}
            <div className="animate-fade-in-up space-y-8">
              <h1 className="text-4xl font-semibold leading-[1.2] tracking-tight text-notarial-light sm:text-5xl lg:text-6xl">
                Agilidad y Precisión en tu Operación Notarial.
              </h1>
              <p className="max-w-lg text-lg leading-relaxed text-slate-300">
                Diligencia formatos con inteligencia documental. Sertuss es el aliado tecnológico en Colombia que potencia a tu equipo legal para procesar minutas a máxima velocidad.
              

              </p>
              <div className="flex flex-wrap gap-4">
                <Button
                  size="lg"
                  className="min-h-[44px] min-w-[44px] rounded-lg bg-notarial-green py-4 px-8 text-secondary-foreground shadow-lg shadow-emerald-500/20 hover:bg-notarial-green/90"
                  onClick={() => {
                    setActiveTab("register");
                    document.
                    getElementById("hero-form")?.
                    scrollIntoView({ behavior: "smooth" });
                  }}
                  aria-label="Registrarse para cargar la primera minuta">
                  
                  Empezar ahora
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  size="lg"
                  variant="ghost-dark"
                  className="min-h-[44px] min-w-[44px] rounded-lg py-4 px-8"
                  onClick={() => setDemoOpen(true)}
                  aria-label="Ver demostración en video">
                  
                  <Play className="mr-1 h-4 w-4" aria-hidden="true" />
                  Ver Demo
                </Button>
              </div>
            </div>

            {/* Right: Auth Form (Glassmorphism) */}
            <div id="hero-form" className="flex items-start justify-center lg:justify-end">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.05] p-6 shadow-2xl backdrop-blur-2xl">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 bg-white/[0.08] border border-white/10 rounded-xl h-11 p-1">
                    <TabsTrigger
                      value="login"
                      className="rounded-lg text-sm font-medium text-slate-400 data-[state=active]:bg-white/[0.12] data-[state=active]:text-white data-[state=active]:shadow-sm transition-all">
                      
                      Ingresar
                    </TabsTrigger>
                    <TabsTrigger
                      value="register"
                      className="rounded-lg text-sm font-medium text-slate-400 data-[state=active]:bg-white/[0.12] data-[state=active]:text-white data-[state=active]:shadow-sm transition-all">
                      
                      Registrarse
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="login" className="mt-6 min-h-[340px]">
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="login-email" className="text-white">
                          Correo electrónico
                        </Label>
                        <Input
                          id="login-email"
                          type="email"
                          placeholder="correo@ejemplo.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          className="h-12 border-white/10 bg-white/10 text-white placeholder:text-slate-400" />
                        
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="login-password" className="text-white">
                          Contraseña
                        </Label>
                        <Input
                          id="login-password"
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          minLength={6}
                          className="h-12 border-white/10 bg-white/10 text-white placeholder:text-slate-400" />
                        
                      </div>
                      <div className="flex items-start">
                        <button
                          type="button"
                          onClick={handleForgotPassword}
                          className="text-xs text-white underline underline-offset-2 hover:text-notarial-gold transition-colors"
                        >
                          ¿Olvidaste tu contraseña?
                        </button>
                      </div>
                      <Button
                        type="submit"
                        className="min-h-[44px] w-full rounded-lg bg-notarial-green py-4 px-8 text-secondary-foreground shadow-lg shadow-emerald-500/20 hover:bg-notarial-green/90"
                        disabled={loading}>
                        {loading ? "Procesando..." : "Ingresar"}
                      </Button>
                    </form>
                  </TabsContent>

                  <TabsContent value="register" className="mt-6 min-h-[340px]">
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="register-email" className="text-white">
                          Correo electrónico
                        </Label>
                        <Input
                          id="register-email"
                          type="email"
                          placeholder="correo@ejemplo.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          className="h-12 border-white/10 bg-white/10 text-white placeholder:text-slate-400" />
                        
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="register-password" className="text-white">
                          Contraseña
                        </Label>
                        <Input
                          id="register-password"
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          minLength={6}
                          className="h-12 border-white/10 bg-white/10 text-white placeholder:text-slate-400" />
                        
                      </div>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="policy"
                          checked={acceptedPolicy}
                          onCheckedChange={(v) => setAcceptedPolicy(v === true)}
                          className="mt-0.5 border-white data-[state=checked]:bg-notarial-green data-[state=checked]:border-notarial-green"
                          aria-label="Aceptar política de tratamiento de datos" />
                        
                        <Label
                          htmlFor="policy"
                          className="text-xs leading-snug text-white cursor-pointer">
                          
                          Acepto la{" "}
                          <a
                            href="#"
                            className="text-white underline underline-offset-2 hover:text-notarial-gold"
                            onClick={(e) => e.stopPropagation()}>
                            
                            Política de Tratamiento de Datos (Ley 1581)
                          </a>
                        </Label>
                      </div>
                      <Button
                        type="submit"
                        className="min-h-[44px] w-full rounded-lg bg-notarial-green py-4 px-8 text-secondary-foreground shadow-lg shadow-emerald-500/20 hover:bg-notarial-green/90"
                        disabled={loading || !acceptedPolicy}>
                        
                        {loading ? "Procesando..." : "Registrarse"}
                      </Button>
                    </form>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </div>
        </section>
        {/* Trust Signals */}
        <section
          className="border-y border-white/10 bg-white/[0.02] sm:px-6 lg:px-8 py-[64px] px-[28px] mx-0"
          aria-label="Señales de confianza">
          
          <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-8 sm:grid-cols-3">
            <div className="flex items-center gap-3 justify-center">
              <Lock
                className="h-6 w-6 shrink-0 text-notarial-gold"
                aria-hidden="true" />
              
              <span className="text-sm font-medium text-white">
                Seguridad Institucional
              </span>
            </div>
            <div className="flex items-center gap-3 justify-center">
              <Building2
                className="h-6 w-6 shrink-0 text-notarial-green"
                aria-hidden="true" />
              
              <span className="text-sm font-medium text-white">
                Alineado con estándares SNR
              </span>
            </div>
            <div className="flex items-center gap-3 justify-center">
              <Shield
                className="h-6 w-6 shrink-0 text-notarial-blue"
                aria-hidden="true" />
              
              <span className="text-sm font-medium text-white">
                Cifrado de Grado Bancario
              </span>
            </div>
          </div>
        </section>

        {/* FAQ Estructurada */}
        <section
          className="bg-white/[0.02] px-4 py-20 sm:px-6 lg:px-8 sm:py-[64px]"
          aria-label="Preguntas frecuentes"
          itemScope
          itemType="https://schema.org/FAQPage">
          
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-10 text-center text-2xl font-semibold text-white sm:text-3xl">
              Preguntas Frecuentes
            </h2>
            <Accordion type="single" collapsible className="space-y-2">
              <div
                itemScope
                itemProp="mainEntity"
                itemType="https://schema.org/Question">
                
                <AccordionItem
                  value="q1"
                  className="rounded-lg border-white/10 bg-white/[0.03] px-4">
                  
             <AccordionTrigger className="text-left text-white hover:no-underline">
                    <span itemProp="name">
                      ¿Cómo automatizar minutas del Banco de Bogotá?
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div
                      itemScope
                      itemProp="acceptedAnswer"
                      itemType="https://schema.org/Answer">
                      
                       <p
                        itemProp="text"
                        className="leading-relaxed text-slate-300">
                        
                        Sertuss integra algoritmos que extraen datos de pagarés, instrucciones y certificados del Banco de Bogotá en segundos. El abogado se enfoca en la validación jurídica mientras el sistema genera la minuta en Word lista para firma.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </div>

              <div
                itemScope
                itemProp="mainEntity"
                itemType="https://schema.org/Question">
                
                <AccordionItem
                  value="q2"
                  className="rounded-lg border-white/10 bg-white/[0.03] px-4">
                  
                  <AccordionTrigger className="text-left text-white hover:no-underline">
                    <span itemProp="name">
                      ¿Cómo evitar errores de registro en escrituras?
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div
                      itemScope
                      itemProp="acceptedAnswer"
                      itemType="https://schema.org/Answer">
                      
                      <p
                        itemProp="text"
                        className="leading-relaxed text-slate-300">
                        
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
            <p className="text-xs text-white">
              © {new Date().getFullYear()} Sertuss. Todos los derechos
              reservados.
            </p>
            <nav className="flex gap-6" aria-label="Enlaces legales">
               <a
                href="#"
                className="min-h-[44px] flex items-center text-xs text-white underline-offset-4 hover:text-notarial-gold hover:underline">
                
                Política de Tratamiento de Datos (Habeas Data)
              </a>
              <a
                href="#"
                className="min-h-[44px] flex items-center text-xs text-white underline-offset-4 hover:text-notarial-gold hover:underline">
                
                Términos de Servicio
              </a>
            </nav>
          </div>
        </div>
      </footer>

      {/* Demo Modal */}
      <DemoModal open={demoOpen} onOpenChange={setDemoOpen} />
    </div>);

};

export default LandingPage;