import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { realtime } from '../services/realtime';

export type UserRole = 'admin' | 'user';
interface AuthContextValue {
  role: UserRole | null;
  signIn: (username: 'admin' | 'user', password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function storedRole(): UserRole | null {
  if (!sessionStorage.getItem('lanvault-session-token')) return null;
  const role = sessionStorage.getItem('lanvault-session-role');
  return role === 'admin' || role === 'user' ? role : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<UserRole | null>(storedRole);
  const signOut = useCallback(() => {
    sessionStorage.removeItem('lanvault-session-token');
    sessionStorage.removeItem('lanvault-session-role');
    realtime.close();
    setRole(null);
  }, []);

  useEffect(() => {
    window.addEventListener('lanvault:unauthorized', signOut);
    return () => window.removeEventListener('lanvault:unauthorized', signOut);
  }, [signOut]);

  const signIn = useCallback(async (username: 'admin' | 'user', password: string) => {
    const session = await api.login(username, password);
    sessionStorage.setItem('lanvault-session-token', session.token);
    sessionStorage.setItem('lanvault-session-role', session.role);
    setRole(session.role);
  }, []);

  const value = useMemo(() => ({ role, signIn, signOut }), [role, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
