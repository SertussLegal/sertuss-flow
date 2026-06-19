import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  organization_id: string | null;
  role: "owner" | "admin" | "operator";
}

interface Organization {
  id: string;
  name: string;
  nit: string | null;
  address: string | null;
  credit_balance: number;
  debug_tools_enabled?: boolean;
}

export interface MembershipEntry {
  organization_id: string;
  role: "owner" | "admin" | "operator";
  is_personal: boolean;
  organization: {
    id: string;
    name: string;
    nit: string | null;
    credit_balance: number;
  };
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  organization: Organization | null;
  credits: number;
  loading: boolean;
  needsOrgSetup: boolean;
  memberships: MembershipEntry[];
  activeOrgId: string | null;
  refreshProfile: () => Promise<void>;
  refreshCredits: () => Promise<void>;
  refreshMemberships: () => Promise<void>;
  switchContext: (orgId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [memberships, setMemberships] = useState<MembershipEntry[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsOrgSetup, setNeedsOrgSetup] = useState(false);

  const fetchMemberships = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("memberships")
      .select("organization_id, role, is_personal, organization:organizations(id, name, nit, credit_balance)")
      .eq("user_id", uid);
    if (data) setMemberships(data as unknown as MembershipEntry[]);

    const { data: ctx } = await supabase
      .from("user_active_context")
      .select("organization_id")
      .eq("user_id", uid)
      .maybeSingle();
    if (ctx?.organization_id) setActiveOrgId(ctx.organization_id);
  }, []);

  const fetchProfile = useCallback(async (currentUser: User) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .single();
    if (data) {
      setProfile(data as Profile);

      if (!data.organization_id) {
        const meta = currentUser.user_metadata;
        if (meta?.org_name || meta?.nit) {
          const { data: orgId, error } = await supabase.rpc("create_organization_for_user", {
            p_user_id: currentUser.id,
            p_org_name: meta.org_name || "",
            p_org_nit: meta.nit || "",
          });
          if (!error && orgId) {
            const { data: updatedProfile } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", currentUser.id)
              .single();
            if (updatedProfile) {
              setProfile(updatedProfile as Profile);
              const { data: org } = await supabase
                .from("organizations")
                .select("*")
                .eq("id", updatedProfile.organization_id)
                .single();
              if (org) setOrganization(org as Organization);
              setNeedsOrgSetup(false);
              await fetchMemberships(currentUser.id);
              return;
            }
          }
        }
        setNeedsOrgSetup(true);
      } else {
        setNeedsOrgSetup(false);
        const { data: org } = await supabase
          .from("organizations")
          .select("*")
          .eq("id", data.organization_id)
          .single();
        if (org) setOrganization(org as Organization);
      }
      await fetchMemberships(currentUser.id);
    }
  }, [fetchMemberships]);

  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user);
  }, [user, fetchProfile]);

  const refreshMemberships = useCallback(async () => {
    if (user) await fetchMemberships(user.id);
  }, [user, fetchMemberships]);

  const refreshCredits = useCallback(async () => {
    if (profile?.organization_id) {
      const { data } = await supabase
        .from("organizations")
        .select("credit_balance")
        .eq("id", profile.organization_id)
        .single();
      if (data) {
        setOrganization((prev) => prev ? { ...prev, credit_balance: data.credit_balance } : prev);
        setMemberships((prev) =>
          prev.map((m) =>
            m.organization_id === profile.organization_id
              ? { ...m, organization: { ...m.organization, credit_balance: data.credit_balance } }
              : m
          )
        );
      }
    }
  }, [profile?.organization_id]);

  const switchContext = useCallback(async (orgId: string) => {
    if (!user) return;
    const { error } = await supabase.rpc("set_active_context", { p_org_id: orgId });
    if (error) throw error;
    setActiveOrgId(orgId);
    // Re-hydrate profile (legacy fields are synced server-side)
    await fetchProfile(user);
  }, [user, fetchProfile]);

  useEffect(() => {
    let lastUserId: string | null = null;
    let profileFetched = false;

    const applySession = (nextSession: Session | null) => {
      setSession(nextSession);
      const nextUser = nextSession?.user ?? null;
      const nextId = nextUser?.id ?? null;

      // Solo emitimos nuevo `user` cuando la identidad cambia.
      // Evita que TOKEN_REFRESHED / USER_UPDATED retrigeren ModuleContext
      // y desmonten <main> (causa raíz del parpadeo al cambiar de módulo).
      if (nextId !== lastUserId) {
        lastUserId = nextId;
        setUser(nextUser);
        if (!nextUser) {
          setProfile(null);
          setOrganization(null);
          setMemberships([]);
          setActiveOrgId(null);
          setNeedsOrgSetup(false);
          profileFetched = false;
        } else if (!profileFetched) {
          profileFetched = true;
          setTimeout(() => fetchProfile(nextUser), 0);
        }
      }
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => applySession(nextSession),
    );

    supabase.auth.getSession().then(({ data: { session: initial } }) => {
      applySession(initial);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  // Fix B: memoizar value para evitar re-renders en cascada de todos los consumidores.
  // Las deps son primitivas/estables (refresh* son useCallback). credit_balance se incluye
  // explícitamente porque deriva de organization pero queremos identidad fina.
  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      organization,
      credits: organization?.credit_balance ?? 0,
      loading,
      needsOrgSetup,
      memberships,
      activeOrgId,
      refreshProfile,
      refreshCredits,
      refreshMemberships,
      switchContext,
    }),
    [
      user,
      session,
      profile,
      organization,
      loading,
      needsOrgSetup,
      memberships,
      activeOrgId,
      refreshProfile,
      refreshCredits,
      refreshMemberships,
      switchContext,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return user ? <>{children}</> : null;
};
