import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase/client';
import { clearCartDraft } from '../lib/cartDraftStorage';

type Role = 'sales' | 'billing' | 'picking' | 'admin' | null;

interface AuthContextValue {
  isAuthenticated: boolean;
  role: Role;
  userName: string | null;
  userId: number | null;
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
  userId: 'paspl_userId',
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
  } catch {
    // ignore
  }
}

function safeLocalStorageRemove(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function safeSessionStorageSet(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeSessionStorageRemove(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Admin section passcode (separate from app access code). */
const ADMIN_PASSCODE = '0807';

function loadFromStorage() {
  const userIdStr = safeLocalStorageGet(LS_KEYS.userId);
  return {
    isAuthenticated: safeLocalStorageGet(LS_KEYS.authenticated) === 'true',
    role: (safeLocalStorageGet(LS_KEYS.role) as Role) || null,
    userName: safeLocalStorageGet(LS_KEYS.userName),
    userId: userIdStr ? parseInt(userIdStr, 10) : null,
    adminUnlocked: safeSessionStorageGet(LS_KEYS.adminUnlocked) === 'true',
  };
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element | null {
  const [isAuthenticated, setIsAuthenticated] = useState(() => loadFromStorage().isAuthenticated);
  const [role, setRole] = useState<Role>(() => loadFromStorage().role);
  const [userName, setUserName] = useState<string | null>(() => loadFromStorage().userName);
  const [userId, setUserId] = useState<number | null>(() => loadFromStorage().userId);
  const [adminUnlocked, setAdminUnlocked] = useState(() => loadFromStorage().adminUnlocked);

  // Backfill userId when name + role exist but id was missing (e.g. older exact-match lookup failed).
  useEffect(() => {
    if (!userName || !role || role === 'admin' || userId !== null) return;
    let cancelled = false;
    void supabase
      .from('users')
      .select('id, full_name')
      .eq('role', role)
      .eq('is_active', true)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const needle = userName.trim().toLowerCase();
        const match = (rows ?? []).find((u) => u.full_name.trim().toLowerCase() === needle);
        if (match?.id != null) {
          setUserId(match.id);
          safeLocalStorageSet(LS_KEYS.userId, String(match.id));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userName, role, userId]);

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
    const resolvedName = name || null;
    setRole(newRole);
    setUserName(resolvedName);
    safeLocalStorageSet(LS_KEYS.role, newRole);
    if (resolvedName) {
      safeLocalStorageSet(LS_KEYS.userName, resolvedName);
    } else {
      safeLocalStorageRemove(LS_KEYS.userName);
    }

    // Resolve userId from users table (case-insensitive name match; scoped by role)
    if (resolvedName) {
      supabase
        .from('users')
        .select('id, full_name')
        .eq('role', newRole)
        .eq('is_active', true)
        .then(({ data: rows, error }) => {
          if (error) {
            console.error('users lookup', error);
            setUserId(null);
            safeLocalStorageRemove(LS_KEYS.userId);
            return;
          }
          const needle = resolvedName.trim().toLowerCase();
          const match = (rows ?? []).find((u) => u.full_name.trim().toLowerCase() === needle);
          const id = match?.id ?? null;
          setUserId(id);
          if (id !== null) {
            safeLocalStorageSet(LS_KEYS.userId, String(id));
          } else {
            safeLocalStorageRemove(LS_KEYS.userId);
          }
        });
    } else {
      setUserId(null);
      safeLocalStorageRemove(LS_KEYS.userId);
    }
  }, []);

  const switchRole = useCallback(() => {
    setRole(null);
    setUserName(null);
    setUserId(null);
    setAdminUnlocked(false);
    safeSessionStorageRemove(LS_KEYS.adminUnlocked);
    safeLocalStorageRemove(LS_KEYS.role);
    safeLocalStorageRemove(LS_KEYS.userName);
    safeLocalStorageRemove(LS_KEYS.userId);
  }, []);

  const logout = useCallback(() => {
    const draftName = safeLocalStorageGet(LS_KEYS.userName);
    const draftIdStr = safeLocalStorageGet(LS_KEYS.userId);
    const parsedId = draftIdStr ? parseInt(draftIdStr, 10) : NaN;
    const draftUserId = Number.isNaN(parsedId) ? null : parsedId;
    clearCartDraft(draftName, draftUserId);

    setIsAuthenticated(false);
    setRole(null);
    setUserName(null);
    setUserId(null);
    setAdminUnlocked(false);
    safeLocalStorageRemove(LS_KEYS.authenticated);
    safeLocalStorageRemove(LS_KEYS.role);
    safeLocalStorageRemove(LS_KEYS.userName);
    safeLocalStorageRemove(LS_KEYS.userId);
    safeSessionStorageRemove(LS_KEYS.adminUnlocked);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        role,
        userName,
        userId,
        adminUnlocked,
        login,
        unlockAdmin,
        selectRole,
        logout,
        switchRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
