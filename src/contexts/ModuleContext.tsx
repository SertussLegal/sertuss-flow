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

export const ModuleProvider = ({ children }: { children: ReactNode }) => {
  const { activeOrgId, user } = useAuth();
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);

  const fetchModules = useCallback(async (orgId: string) => {
    setLoadingModules(true);
    const { data, error } = await supabase
      .from("organization_modules" as any)
      .select("module_slug, enabled")
      .eq("organization_id", orgId)
      .eq("enabled", true);
    if (error) {
      console.error("[ModuleContext] fetch error", error);
      setEnabledModules([]);
    } else {
      setEnabledModules(((data ?? []) as any[]).map((r) => r.module_slug as string));
    }
    setLoadingModules(false);
  }, []);

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
