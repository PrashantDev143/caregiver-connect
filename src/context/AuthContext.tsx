import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

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

// 🔐 bump this if auth logic changes
const AUTH_VERSION = 'v1';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);

  const lastUserIdRef = useRef<string | null>(null);

  // 🧹 Hard reset stale auth storage
  const resetAuthStorage = async () => {
    await supabase.auth.signOut();
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('/login');
  };

  // 🔍 Fetch role safely
  const fetchRole = async (userId: string): Promise<AppRole | null> => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return data.role === 'caregiver' || data.role === 'patient'
      ? data.role
      : null;
  };

  useEffect(() => {
    let mounted = true;

    // 🔐 Invalidate old cached auth automatically
    const storedVersion = localStorage.getItem('auth_version');
    if (storedVersion !== AUTH_VERSION) {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('auth_version', AUTH_VERSION);
    }

    const bootstrap = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;

        if (!data.session?.user) {
          setInitializing(false);
          return;
        }

        setSession(data.session);
        setUser(data.session.user);
        setLoading(true);

        const userRole = await fetchRole(data.session.user.id);

        // 🚑 Stale session recovery
        if (!userRole) {
          await resetAuthStorage();
          return;
        }

        if (mounted) {
          setRole(userRole);
          lastUserIdRef.current = data.session.user.id;
          setLoading(false);
        }
      } catch {
        await resetAuthStorage();
      } finally {
        if (mounted) setInitializing(false);
      }
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!mounted) return;

        if (!newSession?.user) {
          setUser(null);
          setSession(null);
          setRole(null);
          setLoading(false);
          return;
        }

        setSession(newSession);
        setUser(newSession.user);

        if (newSession.user.id !== lastUserIdRef.current) {
          setLoading(true);
          const userRole = await fetchRole(newSession.user.id);

          if (!userRole) {
            await resetAuthStorage();
            return;
          }

          setRole(userRole);
          lastUserIdRef.current = newSession.user.id;
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

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
    await resetAuthStorage();
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
