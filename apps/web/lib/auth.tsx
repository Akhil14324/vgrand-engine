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
import { AUTH_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
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
  configured: boolean;
  getToken: () => Promise<string | null>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Resolves true when signed in immediately, false when email confirmation is pending. */
  signUpWithEmail: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient | null {
  if (!AUTH_CONFIGURED) return null;
  supabase ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabase;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(AUTH_CONFIGURED);

  useEffect(() => {
    const client = getSupabase();
    if (!client) return;
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
      configured: AUTH_CONFIGURED,
      getToken: async () => {
        if (!client) return null;
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
        if (!client) return false;
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) throw error;
        return Boolean(data.session);
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
