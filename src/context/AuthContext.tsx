import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'caregiver' | 'patient';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    role: AppRole
  ) => Promise<{ data: { session: Session | null } | null; error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ data: unknown; error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ROLE_FETCH_ATTEMPTS = 8;
const ROLE_FETCH_DELAY_MS = 500;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const lastFetchedUserIdRef = useRef<string | null>(null);

  const fetchRoleWithRetry = async (userId: string): Promise<AppRole | null> => {
    for (let attempt = 1; attempt <= ROLE_FETCH_ATTEMPTS; attempt++) {
      const { data, error } = await supabase.rpc('get_user_role', {
        _user_id: userId,
      });
      const roleStr = data != null ? String(data).toLowerCase().trim() : '';
      if (!error && (roleStr === 'caregiver' || roleStr === 'patient')) {
        const resolved = roleStr as AppRole;
        console.log('[Auth] role resolved:', { auth_uid: userId, role: resolved, attempt });
        return resolved;
      }
      if (error) {
        console.warn('[Auth] get_user_role attempt', attempt, error);
      }
      if (attempt < ROLE_FETCH_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, ROLE_FETCH_DELAY_MS));
      }
    }
    console.warn('[Auth] role not found after retries:', { auth_uid: userId });
    return null;
  };

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (!mounted) return;
        if (error) {
          console.error('[Auth] getSession error:', error);
          setInitialLoad(false);
          return;
        }

        setSession(data.session);
        setUser(data.session?.user ?? null);

        if (data.session?.user) {
          setRoleLoading(true);
          const resolvedRole = await fetchRoleWithRetry(data.session.user.id);
          if (mounted) {
            setRole(resolvedRole);
            lastFetchedUserIdRef.current = data.session.user.id;
            setRoleLoading(false);
          }
        }
      } catch (err) {
        console.error('[Auth] init error:', err);
      } finally {
        if (mounted) setInitialLoad(false);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;

        if (!session?.user) {
          lastFetchedUserIdRef.current = null;
          setSession(session);
          setUser(null);
          setRole(null);
          setRoleLoading(false);
          return;
        }

        if (session.user.id === lastFetchedUserIdRef.current) {
          setSession(session);
          setUser(session.user);
          return;
        }

        lastFetchedUserIdRef.current = null;
        setSession(session);
        setUser(session.user);
        setRole(null);
        setRoleLoading(true);
        const resolvedRole = await fetchRoleWithRetry(session.user.id);
        if (mounted) {
          setRole(resolvedRole);
          lastFetchedUserIdRef.current = session.user.id;
          setRoleLoading(false);
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
    selectedRole: AppRole
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, role: selectedRole },
      },
    });
    if (error) {
      console.error('[Auth] signUp error:', { message: error.message, name: error.name, full: error });
    } else {
      console.log('[Auth] signUp success:', { email, role: selectedRole, hasSession: !!data?.session });
    }
    return { data: data ? { session: data.session ?? null } : null, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      console.error('[Auth] signIn error:', { message: error.message, name: error.name, full: error });
    } else {
      console.log('[Auth] signIn success:', { email, hasSession: !!data?.session });
    }
    return { data, error };
  };

  const signOut = async () => {
    lastFetchedUserIdRef.current = null;
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
  };

  const loading =
    initialLoad ||
    (!!user && roleLoading) ||
    (!!user && role === null && !roleLoading);

  return (
    <AuthContext.Provider
      value={{ user, session, role, loading, signUp, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
