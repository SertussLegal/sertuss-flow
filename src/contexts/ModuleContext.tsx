import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isSuperAdmin } from "@/lib/superAdmin";

interface ModuleContextType {
  enabledModules: string[];
  isModuleEnabled: (slug: string) => boolean;
  loadingModules: boolean;
  refreshModules: () => Promise<void>;
}

const ModuleContext = createContext<ModuleContextType | undefined>(undefined);

export const useModules = () => {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error("useModules must be used within ModuleProvider");
  return ctx;
};

const RETRY_DELAY_MS = 400;

// Catálogo conocido de módulos. El SuperAdmin obtiene bypass total sobre estos.
const SUPER_ADMIN_MODULES = ["escrituras", "cancelaciones"];

export const ModuleProvider = ({ children }: { children: ReactNode }) => {
  const { activeOrgId, user, profile } = useAuth();
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);

  const superAdmin = useMemo(() => isSuperAdmin(profile?.email), [profile?.email]);

  const fetchOnce = useCallback(async (orgId: string) => {
    const { data, error } = await supabase
      .from("organization_modules" as any)
      .select("module_slug, enabled")
      .eq("organization_id", orgId)
      .eq("enabled", true);
    return { data: ((data ?? []) as unknown) as Array<{ module_slug: string }>, error };
  }, []);

  const fetchModules = useCallback(
    async (orgId: string, { silent }: { silent: boolean } = { silent: false }) => {
      if (!silent) setLoadingModules(true);
      const first = await fetchOnce(orgId);

      if (first.error) {
        console.error("[ModuleContext] fetch error", first.error);
        if (!silent) setEnabledModules([]);
        setLoadingModules(false);
        return;
      }

      if (first.data.length === 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        const retry = await fetchOnce(orgId);
        if (retry.error) {
          console.error("[ModuleContext] retry error", retry.error);
          if (!silent) setEnabledModules([]);
        } else {
          setEnabledModules(retry.data.map((r) => r.module_slug));
        }
      } else {
        setEnabledModules(first.data.map((r) => r.module_slug));
      }
      setLoadingModules(false);
    },
    [fetchOnce],
  );

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setEnabledModules([]);
      setLoadingModules(false);
      return;
    }

    // BYPASS SuperAdmin: nunca se queda sin módulos, sin importar el contexto
    // activo ni la respuesta de RLS sobre organization_modules.
    if (superAdmin) {
      setEnabledModules(SUPER_ADMIN_MODULES);
      setLoadingModules(false);
      return;
    }

    if (!activeOrgId) {
      setLoadingModules(true);
      return;
    }
    // Dep estable: usamos userId (string) en lugar del objeto `user`
    // para no refetchear en cada TOKEN_REFRESHED.
    void fetchModules(activeOrgId);
  }, [activeOrgId, userId, superAdmin, fetchModules]);

  const isModuleEnabled = useCallback(
    (slug: string) => (superAdmin ? true : enabledModules.includes(slug)),
    [enabledModules, superAdmin],
  );

  const refreshModules = useCallback(async () => {
    if (superAdmin) {
      setEnabledModules(SUPER_ADMIN_MODULES);
      return;
    }
    if (activeOrgId) await fetchModules(activeOrgId);
  }, [activeOrgId, fetchModules, superAdmin]);

  return (
    <ModuleContext.Provider
      value={{ enabledModules, isModuleEnabled, loadingModules, refreshModules }}
    >
      {children}
    </ModuleContext.Provider>
  );
};
