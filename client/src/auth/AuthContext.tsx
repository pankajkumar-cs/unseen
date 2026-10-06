import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import type { AnonymousIdentityRow, ProfileRow } from '../types/database';

export interface ViewerProfile {
  userId: string;
  display_name: string;
  emoji: string;
  color: string;
  ghost_id: string | null;
  isRegistered: boolean;
  username?: string;
  role?: ProfileRow['role'];
  moderation_status?: ProfileRow['moderation_status'];
}

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  profile: ViewerProfile | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (invitationCode: string, username: string, password: string, confirmPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

interface AuthEdgeResponse {
  success?: boolean;
  session?: Session;
  error?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function edgeError(error: unknown, message?: string): Error {
  if (message) return new Error(message);
  if (error instanceof Error) return error;
  return new Error('Authentication could not be completed. Please try again.');
}

async function hydrateViewer(session: Session | null): Promise<ViewerProfile | null> {
  if (!session) return null;
  const client = requireSupabase();
  const { data: accountRows, error: accountError } = await client.rpc('get_my_profile');
  if (accountError) throw accountError;
  const account = accountRows?.[0];
  if (account) {
    return {
      userId: session.user.id,
      display_name: account.display_name,
      emoji: account.emoji,
      color: account.color,
      ghost_id: account.ghost_id,
      isRegistered: true,
      username: account.username,
      role: account.role,
      moderation_status: account.moderation_status,
    };
  }
  const { data: identityRows, error: identityError } = await client.rpc('ensure_anonymous_identity');
  if (identityError) throw identityError;
  const identity: AnonymousIdentityRow | undefined = identityRows?.[0];
  if (!identity) return null;
  return {
    userId: session.user.id,
    display_name: identity.display_name,
    emoji: identity.emoji,
    color: identity.color,
    ghost_id: identity.ghost_id,
    isRegistered: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ViewerProfile | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const client = requireSupabase();
    let alive = true;
    let hydrateTimer: ReturnType<typeof setTimeout> | undefined;

    const applySession = async (nextSession: Session | null) => {
      if (!alive) return;
      setSession(nextSession);
      setError(null);
      try {
        const nextProfile = await hydrateViewer(nextSession);
        if (alive) setProfile(nextProfile);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Could not load your anonymous profile.');
      } finally {
        if (alive) setLoading(false);
      }
    };

    const { data: authListener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (hydrateTimer) clearTimeout(hydrateTimer);
      // Run Supabase reads after the auth callback releases its internal lock.
      hydrateTimer = setTimeout(() => void applySession(nextSession), 0);
    });

    void (async () => {
      try {
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (data.session) {
          await applySession(data.session);
          return;
        }
        const { data: anonymousData, error: anonymousError } = await client.auth.signInAnonymously();
        if (anonymousError) throw anonymousError;
        await applySession(anonymousData.session);
      } catch (cause) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : 'Could not connect to UNSEEN.');
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
      if (hydrateTimer) clearTimeout(hydrateTimer);
      authListener.subscription.unsubscribe();
    };
  }, []);

  const login = async (username: string, password: string) => {
    const client = requireSupabase();
    const { data, error: invokeError } = await client.functions.invoke<AuthEdgeResponse>('auth', {
      body: { action: 'login', username, password },
    });
    if (invokeError) throw edgeError(invokeError);
    if (data?.error) throw edgeError(null, data.error);
    if (!data?.session) throw edgeError(null, 'We could not sign you in. Please try again.');
    const { error: sessionError } = await client.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (sessionError) throw sessionError;
  };

  const register = async (invitationCode: string, username: string, password: string, confirmPassword: string) => {
    const client = requireSupabase();
    const { data, error: invokeError } = await client.functions.invoke<AuthEdgeResponse>('auth', {
      body: { action: 'register', invitationCode, username, password, confirmPassword },
    });
    if (invokeError) throw edgeError(invokeError);
    if (data?.error) throw edgeError(null, data.error);
    if (!data?.session) throw edgeError(null, 'Your account was created. Sign in to continue.');
    const { error: sessionError } = await client.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (sessionError) throw sessionError;
  };

  const logout = async () => {
    const client = requireSupabase();
    if (profile?.isRegistered) {
      try {
        const { data: rooms } = await client.rpc('random_chat_current');
        const room = rooms?.[0];
        if (room?.session_key) await client.rpc('random_chat_end', { p_session_key: room.session_key });
        await client.rpc('random_chat_cancel');
      } catch { /* Logout still proceeds if a chat cleanup request cannot reach Supabase. */ }
    }
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    if (signOutError) throw signOutError;
    const { data, error: anonymousError } = await client.auth.signInAnonymously();
    if (anonymousError) throw anonymousError;
    setSession(data.session);
    setProfile(await hydrateViewer(data.session));
  };

  const refreshProfile = async () => setProfile(await hydrateViewer(session));

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    profile,
    error,
    login,
    register,
    logout,
    refreshProfile,
  }), [loading, session, profile, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
