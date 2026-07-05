import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, Plug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const mcpUrl = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mcp`;

export default function Connect() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    toast({ title: "URL copiada", description: "Pégala en tu asistente de IA." });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Plug className="h-6 w-6 text-notarial-gold" />
          <h1 className="text-3xl font-bold tracking-tight">Conecta Sertuss a tu asistente de IA</h1>
        </div>
        <p className="text-muted-foreground">
          Usa ChatGPT o Claude para consultar tus escrituras y cancelaciones de Sertuss.
          Autoriza el acceso una sola vez y el asistente trabajará con tu cuenta.
        </p>
      </header>

      <Card className="border-notarial-gold/40 bg-card/95">
        <CardHeader>
          <CardTitle className="text-lg">URL del servidor</CardTitle>
          <CardDescription>Copia esta dirección. La usarás en los dos pasos siguientes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 p-3">
            <code className="flex-1 truncate text-sm font-mono">{mcpUrl}</code>
            <Button size="sm" variant="outline" onClick={copy} className="shrink-0">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="ml-2">{copied ? "Copiado" : "Copiar"}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conectar desde ChatGPT</CardTitle>
          <CardDescription>Requiere activar el modo Developer.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
            <li>
              Abre{" "}
              <a
                href="https://chatgpt.com/#settings/Connectors/Advanced"
                target="_blank"
                rel="noopener noreferrer"
                className="text-notarial-gold underline"
              >
                Ajustes → Conectores → Avanzado
              </a>{" "}
              y activa el <strong>modo Developer</strong> (revisa el aviso de riesgo).
            </li>
            <li>En el compositor del chat, abre el menú <strong>“+”</strong> y activa el modo Developer.</li>
            <li>Haz clic en <strong>“Add sources”</strong> y luego en <strong>“Connect more”</strong>.</li>
            <li>Ponle un nombre al conector y pega la URL del servidor de arriba.</li>
            <li>Inicia sesión en Sertuss cuando se te pida y aprueba el acceso.</li>
            <li>Pídele a ChatGPT que use Sertuss (por ejemplo: <em>“lista mis cancelaciones”</em>).</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conectar desde Claude</CardTitle>
          <CardDescription>Disponible en planes con conectores personalizados.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
            <li>
              Abre{" "}
              <a
                href="https://claude.ai/customize/connectors?modal=add-custom-connector"
                target="_blank"
                rel="noopener noreferrer"
                className="text-notarial-gold underline"
              >
                Claude → Conectores → Añadir conector personalizado
              </a>
              .
            </li>
            <li>Ponle un nombre al conector y pega la URL del servidor.</li>
            <li>Inicia sesión en Sertuss y aprueba el acceso.</li>
            <li>Activa el conector desde el compositor del chat y pídele a Claude que use Sertuss.</li>
          </ol>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        El asistente descubre automáticamente las herramientas disponibles (consultar escrituras,
        cancelaciones y detalle por ID). Todo el acceso respeta los permisos de tu organización activa.
      </p>
    </div>
  );
}
