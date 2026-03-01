import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '../lib/supabase/client';

type Role = 'sales' | 'billing' | 'picking' | 'admin' | null;

interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role;
  userName: string | null;
  adminUnlocked: boolean;
  login: (code: string) => Promise<boolean>;
  unlockAdmin: (code: string) => boolean;
  selectRole: (role: NonNullable<Role>, name?: string) => void;
  logout: () => void;
  switchRole: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LS_KEYS = {
  authenticated: 'paspl_authenticated',
  role: 'paspl_role',
  userName: 'paspl_userName',
  adminUnlocked: 'paspl_admin_unlocked',
} as const;

/** Admin section passcode (separate from app access code). */
const ADMIN_PASSCODE = '0807';

function loadFromStorage() {
  return {
    isAuthenticated: localStorage.getItem(LS_KEYS.authenticated) === 'true',
    role: (localStorage.getItem(LS_KEYS.role) as Role) || null,
    userName: localStorage.getItem(LS_KEYS.userName) || null,
    adminUnlocked: sessionStorage.getItem(LS_KEYS.adminUnlocked) === 'true',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => loadFromStorage().isAuthenticated);
  const [role, setRole] = useState<Role>(() => loadFromStorage().role);
  const [userName, setUserName] = useState<string | null>(() => loadFromStorage().userName);
  const [adminUnlocked, setAdminUnlocked] = useState(() => loadFromStorage().adminUnlocked);

  const login = useCallback(async (code: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'access_code')
      .single();

    if (error || !data) return false;

    if (data.value === code) {
      setIsAuthenticated(true);
      localStorage.setItem(LS_KEYS.authenticated, 'true');
      return true;
    }
    return false;
  }, []);

  const unlockAdmin = useCallback((code: string): boolean => {
    if (code === ADMIN_PASSCODE) {
      setAdminUnlocked(true);
      sessionStorage.setItem(LS_KEYS.adminUnlocked, 'true');
      return true;
    }
    return false;
  }, []);

  const selectRole = useCallback((newRole: NonNullable<Role>, name?: string) => {
    const resolvedName = name || (newRole === 'picking' ? 'Picker' : null);
    setRole(newRole);
    setUserName(resolvedName);
    localStorage.setItem(LS_KEYS.role, newRole);
    if (resolvedName) {
      localStorage.setItem(LS_KEYS.userName, resolvedName);
    } else {
      localStorage.removeItem(LS_KEYS.userName);
    }
  }, []);

  const switchRole = useCallback(() => {
    setRole(null);
    setUserName(null);
    setAdminUnlocked(false);
    sessionStorage.removeItem(LS_KEYS.adminUnlocked);
    localStorage.removeItem(LS_KEYS.role);
    localStorage.removeItem(LS_KEYS.userName);
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setRole(null);
    setUserName(null);
    setAdminUnlocked(false);
    localStorage.removeItem(LS_KEYS.authenticated);
    localStorage.removeItem(LS_KEYS.role);
    localStorage.removeItem(LS_KEYS.userName);
    sessionStorage.removeItem(LS_KEYS.adminUnlocked);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, role, userName, adminUnlocked, login, unlockAdmin, selectRole, logout, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
