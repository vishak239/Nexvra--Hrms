"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, api, ensureCsrf } from "./api";
import { toApiError } from "./hooks";
import type { Me } from "./types";

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Set when the session could not be checked (e.g. server unreachable), not for "logged out". */
  error: ApiError | null;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Display-only check. The backend enforces every permission independently. */
  can: (...anyOf: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const refresh = useCallback(async () => {
    try {
      const session = await api<{ authenticated: boolean; user: Me | null }>("/api/auth/session/");
      setMe(session.user);
      setError(null);
    } catch (e) {
      const err = toApiError(e);
      setMe(null);
      setError(err.isUnauthenticated ? null : err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    await ensureCsrf();
    const user = await api<Me>("/api/auth/login/", { body: { email, password } });
    setMe(user);
    setError(null);
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout/", { method: "POST" });
    } catch {
      // The session is cleared locally regardless.
    } finally {
      setMe(null);
    }
  }, []);

  const can = useCallback((...anyOf: string[]) => !!me && anyOf.some((p) => me.permissions.includes(p)), [me]);

  return (
    <AuthContext.Provider value={{ me, loading, error, login, logout, refresh, can }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Renders children only if the user holds any of the permissions (display only). */
export function Can({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...(Array.isArray(perm) ? perm : [perm])) ? <>{children}</> : null;
}
