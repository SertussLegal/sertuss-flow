import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Scale, Shield } from "lucide-react";

// Typed wrapper around the beta supabase.auth.oauth namespace.
type AuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
const authOauth = (supabase.auth as unknown as { oauth: AuthOAuth }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("Falta el parámetro authorization_id.");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await authOauth.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) return setError(error.message);
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e: any) {
        setError(e?.message ?? "Error al cargar la autorización.");
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const { data, error } = approve
        ? await authOauth.approveAuthorization(authorizationId)
        : await authOauth.denyAuthorization(authorizationId);
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        return setError("El servidor de autorización no devolvió URL de redirección.");
      }
      window.location.href = target;
    } catch (e: any) {
      setBusy(false);
      setError(e?.message ?? "Error al procesar la decisión.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-notarial-dark p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <Scale className="h-10 w-10 text-notarial-gold" />
            <Shield className="h-8 w-8 text-notarial-green" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Sertuss</h1>
        </div>

        <Card className="border-notarial-blue/30 bg-card/95 shadow-2xl backdrop-blur">
          <CardHeader>
            <CardTitle className="text-xl">Conectar aplicación externa</CardTitle>
            <CardDescription>
              Una aplicación quiere acceder a tu cuenta Sertuss vía MCP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
                {error}
              </p>
            )}
            {!error && !details && <p className="text-sm text-muted-foreground">Cargando…</p>}
            {details && (
              <>
                <div className="rounded-md border border-border bg-background/40 p-3 text-sm">
                  <p className="font-semibold text-foreground">
                    {details.client?.name ?? "Aplicación externa"}
                  </p>
                  {details.client?.uri && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{details.client.uri}</p>
                  )}
                  <p className="mt-3 text-muted-foreground">
                    Si apruebas, esta aplicación podrá usar Sertuss actuando en tu nombre a través
                    de las herramientas MCP publicadas por esta cuenta.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => decide(false)}
                  >
                    Denegar
                  </Button>
                  <Button
                    className="flex-1 bg-notarial-blue hover:bg-notarial-blue/90"
                    disabled={busy}
                    onClick={() => decide(true)}
                  >
                    Aprobar
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
