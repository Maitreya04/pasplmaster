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

function safeLocalStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function safeLocalStorageRemove(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

function safeSessionStorageSet(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {}
}

function safeSessionStorageRemove(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {}
}

/** Admin section passcode (separate from app access code). */
const ADMIN_PASSCODE = '0807';

function loadFromStorage() {
  return {
    isAuthenticated: safeLocalStorageGet(LS_KEYS.authenticated) === 'true',
    role: (safeLocalStorageGet(LS_KEYS.role) as Role) || null,
    userName: safeLocalStorageGet(LS_KEYS.userName),
    adminUnlocked: safeSessionStorageGet(LS_KEYS.adminUnlocked) === 'true',
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
      safeLocalStorageSet(LS_KEYS.authenticated, 'true');
      return true;
    }
    return false;
  }, []);

  const unlockAdmin = useCallback((code: string): boolean => {
    if (code === ADMIN_PASSCODE) {
      setAdminUnlocked(true);
      safeSessionStorageSet(LS_KEYS.adminUnlocked, 'true');
      return true;
    }
    return false;
  }, []);

  const selectRole = useCallback((newRole: NonNullable<Role>, name?: string) => {
    const resolvedName = name || (newRole === 'picking' ? 'Picker' : null);
    setRole(newRole);
    setUserName(resolvedName);
    safeLocalStorageSet(LS_KEYS.role, newRole);
    if (resolvedName) {
      safeLocalStorageSet(LS_KEYS.userName, resolvedName);
    } else {
      safeLocalStorageRemove(LS_KEYS.userName);
    }
  }, []);

  const switchRole = useCallback(() => {
    setRole(null);
    setUserName(null);
    setAdminUnlocked(false);
    safeSessionStorageRemove(LS_KEYS.adminUnlocked);
    safeLocalStorageRemove(LS_KEYS.role);
    safeLocalStorageRemove(LS_KEYS.userName);
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setRole(null);
    setUserName(null);
    setAdminUnlocked(false);
    safeLocalStorageRemove(LS_KEYS.authenticated);
    safeLocalStorageRemove(LS_KEYS.role);
    safeLocalStorageRemove(LS_KEYS.userName);
    safeSessionStorageRemove(LS_KEYS.adminUnlocked);
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
