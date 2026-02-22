import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { stopAllAudioPlayback } from '@/lib/audioManager';

type AppRole = 'caregiver' | 'patient';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  initializing: boolean;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    role: AppRole
  ) => Promise<{
    data: { session: Session | null } | null;
    error: (Error & { status?: number; code?: string }) | null;
  }>;
  signIn: (
    email: string,
    password: string
  ) => Promise<{ data: unknown; error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SESSION_VALIDATION_TIMEOUT_MS = 8000;

const isAuthStorageKey = (key: string) =>
  key.includes('supabase.auth.token') ||
  (key.startsWith('sb-') && key.endsWith('-auth-token'));

const isProtectedPath = (pathname: string) =>
  pathname.startsWith('/caregiver') || pathname.startsWith('/patient');

const isSessionValid = (candidate: Session | null): candidate is Session => {
  if (!candidate?.user || !candidate.access_token) {
    return false;
  }

  if (typeof candidate.expires_at === 'number') {
    return candidate.expires_at * 1000 > Date.now();
  }

  return true;
};

const getStoredSession = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (parsed.currentSession && typeof parsed.currentSession === 'object') {
      return parsed.currentSession as Record<string, unknown>;
    }

    if (parsed.session && typeof parsed.session === 'object') {
      return parsed.session as Record<string, unknown>;
    }

    return parsed;
  } catch {
    return null;
  }
};

const shouldRemoveStoredSession = (raw: string | null): boolean => {
  const storedSession = getStoredSession(raw);

  if (!storedSession) {
    return true;
  }

  const accessToken = storedSession.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    return true;
  }

  const expiresAt = storedSession.expires_at;
  if (typeof expiresAt === 'number' && expiresAt * 1000 <= Date.now()) {
    return true;
  }

  return false;
};

const clearInvalidStoredSessions = () => {
  const stores: Storage[] = [localStorage, sessionStorage];

  stores.forEach((store) => {
    const keysToRemove: string[] = [];

    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !isAuthStorageKey(key)) {
        continue;
      }

      if (shouldRemoveStoredSession(store.getItem(key))) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => store.removeItem(key));
  });
};

const clearAllAuthStorageKeys = () => {
  const stores: Storage[] = [localStorage, sessionStorage];

  stores.forEach((store) => {
    const keysToRemove: string[] = [];

    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key || !isAuthStorageKey(key)) {
        continue;
      }
      keysToRemove.push(key);
    }

    keysToRemove.forEach((key) => store.removeItem(key));
  });
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(true);

  const mountedRef = useRef(true);
  const lastUserIdRef = useRef<string | null>(null);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setSession(null);
    setRole(null);
    lastUserIdRef.current = null;
  }, []);

  const redirectToLogin = useCallback(() => {
    if (window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
  }, []);

  const fetchRole = async (userId: string): Promise<AppRole | null> => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data.role === 'caregiver' || data.role === 'patient'
      ? data.role
      : null;
  };

  const validateSessionWithServer = useCallback(
    async (candidate: Session): Promise<boolean> => {
      const authRequest = supabase.auth
        .getUser(candidate.access_token)
        .then(({ data, error }) => {
          if (error || !data.user) {
            return null;
          }
          return data.user;
        })
        .catch(() => null);

      const timeout = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), SESSION_VALIDATION_TIMEOUT_MS);
      });

      const remoteUser = await Promise.race([authRequest, timeout]);

      if (!remoteUser) {
        return false;
      }

      return remoteUser.id === candidate.user.id;
    },
    []
  );

  const invalidateSession = useCallback(async (redirect: boolean) => {
    try {
      await supabase.auth.signOut();
    } catch {
      // Best effort cleanup continues even if sign-out fails.
    }

    stopAllAudioPlayback();
    clearAllAuthStorageKeys();
    clearInvalidStoredSessions();
    queryClient.clear();

    if (!mountedRef.current) {
      return;
    }

    clearAuthState();

    if (redirect) {
      redirectToLogin();
    }
  }, [clearAuthState, queryClient, redirectToLogin]);

  useEffect(() => {
    mountedRef.current = true;

    const syncSession = async (
      incomingSession: Session | null,
      redirectOnFailure: boolean
    ) => {
      if (!incomingSession) {
        clearAuthState();
        clearInvalidStoredSessions();
        if (redirectOnFailure) {
          redirectToLogin();
        }
        return false;
      }

      if (!isSessionValid(incomingSession)) {
        await invalidateSession(redirectOnFailure);
        return false;
      }

      const sessionIsTrusted = await validateSessionWithServer(incomingSession);
      if (!mountedRef.current) {
        return false;
      }

      if (!sessionIsTrusted) {
        await invalidateSession(redirectOnFailure);
        return false;
      }

      setLoading(true);

      const resolvedRole = await fetchRole(incomingSession.user.id);
      if (!mountedRef.current) {
        return false;
      }

      if (!resolvedRole) {
        await invalidateSession(redirectOnFailure);
        return false;
      }

      setSession(incomingSession);
      setUser(incomingSession.user);
      setRole(resolvedRole);
      lastUserIdRef.current = incomingSession.user.id;
      return true;
    };

    const bootstrap = async () => {
      const redirectOnFailure = isProtectedPath(window.location.pathname);
      setLoading(true);
      clearInvalidStoredSessions();

      try {
        const { data, error } = await supabase.auth.getSession();
        if (!mountedRef.current) {
          return;
        }

        if (error) {
          await invalidateSession(redirectOnFailure);
          return;
        }

        await syncSession(data.session, redirectOnFailure);
      } catch {
        await invalidateSession(redirectOnFailure);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setInitializing(false);
        }
      }
    };

    void bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mountedRef.current) {
          return;
        }

        const redirectOnFailure = isProtectedPath(window.location.pathname);

        if (!newSession) {
          clearAuthState();
          clearInvalidStoredSessions();
          queryClient.clear();
          setLoading(false);
          if (redirectOnFailure) {
            redirectToLogin();
          }
          return;
        }

        if (!isSessionValid(newSession)) {
          await invalidateSession(redirectOnFailure);
          setLoading(false);
          return;
        }

        const sessionIsTrusted = await validateSessionWithServer(newSession);
        if (!mountedRef.current) {
          return;
        }

        if (!sessionIsTrusted) {
          await invalidateSession(redirectOnFailure);
          setLoading(false);
          return;
        }

        if (newSession.user.id === lastUserIdRef.current) {
          setSession(newSession);
          setUser(newSession.user);
          setLoading(false);
          return;
        }

        setLoading(true);

        try {
          const resolvedRole = await fetchRole(newSession.user.id);
          if (!mountedRef.current) {
            return;
          }

          if (!resolvedRole) {
            await invalidateSession(redirectOnFailure);
            return;
          }

          setSession(newSession);
          setUser(newSession.user);
          setRole(resolvedRole);
          lastUserIdRef.current = newSession.user.id;
        } catch {
          await invalidateSession(redirectOnFailure);
        } finally {
          if (mountedRef.current) {
            setLoading(false);
          }
        }
      }
    );

    return () => {
      mountedRef.current = false;
      listener.subscription.unsubscribe();
    };
  }, [
    clearAuthState,
    invalidateSession,
    queryClient,
    redirectToLogin,
    validateSessionWithServer,
  ]);

  const signUp = async (
    email: string,
    password: string,
    name: string,
    role: AppRole
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role } },
    });

    if (error) {
      console.error('[Auth] signUp error:', {
        message: error.message,
        name: error.name,
        status: (error as { status?: number }).status ?? null,
        code: (error as { code?: string }).code ?? null,
        full: error,
      });
    }

    return { data: data ? { session: data.session ?? null } : null, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signOut = async () => {
    setLoading(true);

    try {
      await supabase.auth.signOut();
    } finally {
      stopAllAudioPlayback();
      localStorage.clear();
      sessionStorage.clear();
      queryClient.clear();
      clearAuthState();
      setLoading(false);
      setInitializing(false);
      redirectToLogin();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        initializing,
        loading,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
