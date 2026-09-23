"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEV_MODE, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { registerTokenGetter } from "./api";

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  isDev: boolean;
  getToken: () => Promise<string | null>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const DEV_USER: AuthUser = {
  id: "dev-user",
  email: "dev@prompthub.local",
  name: "Dev User",
};

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (DEV_MODE) return null;
  supabase ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabase;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(DEV_MODE ? DEV_USER : null);
  const [loading, setLoading] = useState(!DEV_MODE);

  useEffect(() => {
    const client = getSupabase();
    if (!client) {
      registerTokenGetter(async () => "dev-token");
      return;
    }
    client.auth.getSession().then(({ data }) => {
      setUser(toAuthUser(data.session?.user));
      setLoading(false);
    });
    const { data: sub } = client.auth.onAuthStateChange((_evt, session) => {
      setUser(toAuthUser(session?.user));
      setLoading(false);
    });
    registerTokenGetter(async () => {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const client = getSupabase();
    return {
      user,
      loading,
      isDev: DEV_MODE,
      getToken: async () => {
        if (!client) return "dev-token";
        const { data } = await client.auth.getSession();
        return data.session?.access_token ?? null;
      },
      signInWithEmail: async (email, password) => {
        if (!client) return;
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      },
      signUpWithEmail: async (email, password) => {
        if (!client) return;
        const { error } = await client.auth.signUp({ email, password });
        if (error) throw error;
      },
      signInWithGoogle: async () => {
        if (!client) return;
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        });
        if (error) throw error;
      },
      signOut: async () => {
        await client?.auth.signOut();
      },
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

function toAuthUser(
  user:
    | {
        id: string;
        email?: string;
        user_metadata?: Record<string, unknown>;
      }
    | null
    | undefined,
): AuthUser | null {
  if (!user?.email) return null;
  return {
    id: user.id,
    email: user.email,
    name: (user.user_metadata?.full_name ?? user.user_metadata?.name) as
      | string
      | undefined,
    avatarUrl: user.user_metadata?.avatar_url as string | undefined,
  };
}
