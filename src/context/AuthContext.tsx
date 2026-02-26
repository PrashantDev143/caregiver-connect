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
const SESSION_VALIDATION_TIMEOUT_MS = 6000;
const SIGN_OUT_TIMEOUT_MS = 5000;
const ROLE_RESOLUTION_TIMEOUT_MS = 4500;
const ROLE_FETCH_RETRY_COUNT = 3;
const ROLE_FETCH_RETRY_DELAY_MS = 450;

const isAuthStorageKey = (key: string) =>
  key.includes('supabase.auth.token') ||
  (key.startsWith('sb-') && key.endsWith('-auth-token'));

const isProtectedPath = (pathname: string) =>
  pathname.startsWith('/caregiver') || pathname.startsWith('/patient');

const normalizeRole = (value: unknown): AppRole | null => {
  if (value === 'caregiver' || value === 'patient') {
    return value;
  }
  return null;
};

const isLikelyNetworkError = (message: string | undefined) => {
  if (!message) return false;
  return /failed to fetch|network|timed out|timeout|load failed/i.test(message);
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const navigateClientSide = (targetPath: string) => {
  const currentPathWithQuery = `${window.location.pathname}${window.location.search}`;
  if (currentPathWithQuery === targetPath) {
    return true;
  }

  try {
    window.history.replaceState(window.history.state, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return true;
  } catch {
    return false;
  }
};

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

const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> => {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
  });

  const result: T | null = await Promise.race([
    promise.then((value) => value as T | null),
    timeoutPromise,
  ]).catch(() => null);

  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
  }

  return result;
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
    if (window.location.pathname === '/login') {
      return;
    }

    const navigated = navigateClientSide('/login');
    if (!navigated) {
      // Fallback to root, which always exists even if SPA rewrites are missing.
      window.location.replace('/');
    }
  }, []);

  const fetchRole = async (
    userId: string,
    fallbackRole: AppRole | null
  ): Promise<AppRole | null> => {
    for (let attempt = 0; attempt < ROLE_FETCH_RETRY_COUNT; attempt += 1) {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      const resolvedRole = normalizeRole(data?.role);
      if (resolvedRole) {
        return resolvedRole;
      }

      if (
        attempt < ROLE_FETCH_RETRY_COUNT - 1 &&
        (!data || (error && isLikelyNetworkError(error.message)))
      ) {
        await sleep(ROLE_FETCH_RETRY_DELAY_MS);
        continue;
      }

      break;
    }

    return fallbackRole;
  };

  const validateSessionWithServer = useCallback(
    async (candidate: Session): Promise<boolean | null> => {
      const timeoutMarker = Symbol('validation-timeout');
      let timeoutId: number | undefined;

      try {
        const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
          timeoutId = window.setTimeout(
            () => resolve(timeoutMarker),
            SESSION_VALIDATION_TIMEOUT_MS
          );
        });

        const result = await Promise.race([
          supabase.auth.getUser(candidate.access_token),
          timeoutPromise,
        ]);

        if (result === timeoutMarker) {
          return null;
        }

        const { data, error } = result;
        if (error || !data.user) {
          if (isLikelyNetworkError(error?.message)) {
            return null;
          }
          return false;
        }

        return data.user.id === candidate.user.id;
      } catch {
        return null;
      } finally {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
        }
      }
    },
    []
  );

  const invalidateSession = useCallback(async (redirect: boolean) => {
    try {
      await withTimeout(supabase.auth.signOut(), SIGN_OUT_TIMEOUT_MS);
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

      const fallbackRole = normalizeRole(incomingSession.user.user_metadata?.role);
      const sessionIsTrusted = await validateSessionWithServer(incomingSession);
      if (!mountedRef.current) {
        return false;
      }

      if (sessionIsTrusted === false) {
        await invalidateSession(redirectOnFailure);
        return false;
      }
      if (sessionIsTrusted === null) {
        console.warn('[Auth] Session validation skipped due network timeout; continuing with cached session.');
      }

      setLoading(true);

      const resolvedRole = await withTimeout(
        fetchRole(incomingSession.user.id, fallbackRole),
        ROLE_RESOLUTION_TIMEOUT_MS
      );
      if (!mountedRef.current) {
        return false;
      }

      const finalRole = resolvedRole ?? fallbackRole;
      if (!finalRole) {
        await invalidateSession(redirectOnFailure);
        return false;
      }

      setSession(incomingSession);
      setUser(incomingSession.user);
      setRole(finalRole);
      lastUserIdRef.current = incomingSession.user.id;
      return true;
    };

    const bootstrap = async () => {
      const redirectOnFailure = isProtectedPath(window.location.pathname);
      setLoading(true);
      clearInvalidStoredSessions();

      try {
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          SESSION_VALIDATION_TIMEOUT_MS
        );
        if (!mountedRef.current) {
          return;
        }

        if (!sessionResult) {
          clearAuthState();
          clearInvalidStoredSessions();
          if (redirectOnFailure) {
            redirectToLogin();
          }
          return;
        }

        const { data, error } = sessionResult;
        if (error) {
          clearAuthState();
          clearInvalidStoredSessions();
          if (redirectOnFailure) {
            redirectToLogin();
          }
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

        const fallbackRole = normalizeRole(newSession.user.user_metadata?.role);
        const sessionIsTrusted = await validateSessionWithServer(newSession);
        if (!mountedRef.current) {
          return;
        }

        if (sessionIsTrusted === false) {
          await invalidateSession(redirectOnFailure);
          setLoading(false);
          return;
        }
        if (sessionIsTrusted === null) {
          console.warn('[Auth] Realtime session validation skipped due network timeout.');
        }

        if (newSession.user.id === lastUserIdRef.current) {
          setSession(newSession);
          setUser(newSession.user);
          if (!role && fallbackRole) {
            setRole(fallbackRole);
          }
          setLoading(false);
          return;
        }

        setLoading(true);

        try {
          const resolvedRole = await withTimeout(
            fetchRole(newSession.user.id, fallbackRole),
            ROLE_RESOLUTION_TIMEOUT_MS
          );
          if (!mountedRef.current) {
            return;
          }

          const finalRole = resolvedRole ?? fallbackRole;
          if (!finalRole) {
            await invalidateSession(redirectOnFailure);
            return;
          }

          setSession(newSession);
          setUser(newSession.user);
          setRole(finalRole);
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
      await withTimeout(supabase.auth.signOut(), SIGN_OUT_TIMEOUT_MS);
    } finally {
      stopAllAudioPlayback();
      clearAllAuthStorageKeys();
      clearInvalidStoredSessions();
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
