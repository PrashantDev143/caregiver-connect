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
const SIGN_OUT_TIMEOUT_MS = 5000;
const AUTH_RETRY_DELAY_MS = 400;
const ROLE_FETCH_MAX_RETRIES = 4;
const SESSION_VALIDATION_CACHE_MS = 30_000;

const isAuthStorageKey = (key: string) =>
  key.includes('supabase.auth.token') ||
  (key.startsWith('sb-') && key.endsWith('-auth-token'));

const isProtectedPath = (pathname: string) =>
  pathname.startsWith('/caregiver') || pathname.startsWith('/patient');

const isRetryableNetworkErrorMessage = (message: string | undefined) => {
  if (!message) return false;
  return /failed to fetch|network|network request failed|fetch failed|load failed/i.test(
    message
  );
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const normalizeRole = (value: unknown): AppRole | null => {
  if (value === 'caregiver' || value === 'patient') {
    return value;
  }
  return null;
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

  const result = await Promise.race<[T | null]>([
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
  const validatedTokenCacheRef = useRef<Map<string, number>>(new Map());

  const clearAuthState = useCallback(() => {
    setUser(null);
    setSession(null);
    setRole(null);
    lastUserIdRef.current = null;
    validatedTokenCacheRef.current.clear();
  }, []);

  const redirectToLogin = useCallback(() => {
    if (window.location.pathname !== '/login') {
      window.location.replace('/login');
    }
  }, []);

  const fetchRole = async (
    userId: string,
    metadataRole?: unknown
  ): Promise<AppRole | null> => {
    const metadataResolvedRole = normalizeRole(metadataRole);

    for (let attempt = 0; attempt < ROLE_FETCH_MAX_RETRIES; attempt += 1) {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      const dbRole = normalizeRole(data?.role);
      if (dbRole) {
        return dbRole;
      }

      if (!error && data === null) {
        if (attempt < ROLE_FETCH_MAX_RETRIES - 1) {
          await sleep(AUTH_RETRY_DELAY_MS);
          continue;
        }
        return metadataResolvedRole;
      }

      if (
        error &&
        attempt < ROLE_FETCH_MAX_RETRIES - 1 &&
        isRetryableNetworkErrorMessage(error.message)
      ) {
        await sleep(AUTH_RETRY_DELAY_MS);
        continue;
      }

      break;
    }

    return metadataResolvedRole;
  };

  const validateSessionWithServer = useCallback(
    async (candidate: Session): Promise<boolean> => {
      const accessToken = candidate.access_token;
      const cachedAt = accessToken
        ? validatedTokenCacheRef.current.get(accessToken)
        : undefined;

      if (
        typeof cachedAt === 'number' &&
        Date.now() - cachedAt < SESSION_VALIDATION_CACHE_MS
      ) {
        return true;
      }

      const authRequest = supabase.auth
        .getUser(accessToken)
        .then(({ data, error }) => {
          if (error || !data.user) {
            return null;
          }
          return data.user;
        })
        .catch(() => null);

      const remoteUser = await withTimeout(
        authRequest,
        SESSION_VALIDATION_TIMEOUT_MS
      );

      if (!remoteUser) {
        return false;
      }

      const isMatch = remoteUser.id === candidate.user.id;
      if (isMatch && accessToken) {
        validatedTokenCacheRef.current.set(accessToken, Date.now());
      }

      return isMatch;
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

      const sessionIsTrusted = await validateSessionWithServer(incomingSession);
      if (!mountedRef.current) {
        return false;
      }

      if (!sessionIsTrusted) {
        await invalidateSession(redirectOnFailure);
        return false;
      }

      setLoading(true);

      const resolvedRole = await withTimeout(
        fetchRole(incomingSession.user.id, incomingSession.user.user_metadata?.role),
        SESSION_VALIDATION_TIMEOUT_MS
      );
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
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          SESSION_VALIDATION_TIMEOUT_MS
        );
        if (!mountedRef.current) {
          return;
        }

        if (!sessionResult) {
          await invalidateSession(redirectOnFailure);
          return;
        }

        const { data, error } = sessionResult;
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
          const resolvedRole = await withTimeout(
            fetchRole(newSession.user.id, newSession.user.user_metadata?.role),
            SESSION_VALIDATION_TIMEOUT_MS
          );
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
    let data: { session: Session | null } | null = null;
    let error: (Error & { status?: number; code?: string }) | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name, role } },
        });

        data = response.data ? { session: response.data.session ?? null } : null;
        error = response.error;

        if (!error) {
          break;
        }

        if (
          attempt === 0 &&
          isRetryableNetworkErrorMessage(error.message)
        ) {
          await sleep(AUTH_RETRY_DELAY_MS);
          continue;
        }
        break;
      } catch (caught) {
        const wrapped =
          caught instanceof Error ? caught : new Error('Signup failed');
        error = wrapped as Error & { status?: number; code?: string };
        data = null;

        if (
          attempt === 0 &&
          isRetryableNetworkErrorMessage(wrapped.message)
        ) {
          await sleep(AUTH_RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }

    if (error) {
      console.error('[Auth] signUp error:', {
        message: error.message,
        name: error.name,
        status: (error as { status?: number }).status ?? null,
        code: (error as { code?: string }).code ?? null,
        full: error,
      });
    }

    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    let data: unknown = null;
    let error: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        data = response.data;
        error = response.error;

        if (!error) {
          break;
        }

        if (
          attempt === 0 &&
          isRetryableNetworkErrorMessage(error.message)
        ) {
          await sleep(AUTH_RETRY_DELAY_MS);
          continue;
        }
        break;
      } catch (caught) {
        const wrapped =
          caught instanceof Error ? caught : new Error('Login failed');
        data = null;
        error = wrapped;

        if (
          attempt === 0 &&
          isRetryableNetworkErrorMessage(wrapped.message)
        ) {
          await sleep(AUTH_RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }

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
