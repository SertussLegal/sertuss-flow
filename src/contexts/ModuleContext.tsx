import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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

export const ModuleProvider = ({ children }: { children: ReactNode }) => {
  const { activeOrgId, user } = useAuth();
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);

  const fetchOnce = useCallback(async (orgId: string) => {
    const { data, error } = await supabase
      .from("organization_modules" as any)
      .select("module_slug, enabled")
      .eq("organization_id", orgId)
      .eq("enabled", true);
    return { data: ((data ?? []) as unknown) as Array<{ module_slug: string }>, error };
  }, []);

  const fetchModules = useCallback(
    async (orgId: string) => {
      setLoadingModules(true);
      const first = await fetchOnce(orgId);

      if (first.error) {
        console.error("[ModuleContext] fetch error", first.error);
        setEnabledModules([]);
        setLoadingModules(false);
        return;
      }

      // Empty + no error → likely an RLS race right after sign-in. Retry once.
      if (first.data.length === 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        const retry = await fetchOnce(orgId);
        if (retry.error) {
          console.error("[ModuleContext] retry error", retry.error);
          setEnabledModules([]);
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

  useEffect(() => {
    if (!user) {
      setEnabledModules([]);
      setLoadingModules(false);
      return;
    }
    if (!activeOrgId) {
      // still resolving org — keep loading to avoid 403 flash
      setLoadingModules(true);
      return;
    }
    void fetchModules(activeOrgId);
  }, [activeOrgId, user, fetchModules]);

  const isModuleEnabled = useCallback(
    (slug: string) => enabledModules.includes(slug),
    [enabledModules],
  );

  const refreshModules = useCallback(async () => {
    if (activeOrgId) await fetchModules(activeOrgId);
  }, [activeOrgId, fetchModules]);

  return (
    <ModuleContext.Provider
      value={{ enabledModules, isModuleEnabled, loadingModules, refreshModules }}
    >
      {children}
    </ModuleContext.Provider>
  );
};
