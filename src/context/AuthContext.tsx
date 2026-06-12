import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase/client';
import { clearCartDraft } from '../lib/cartDraftStorage';
import { warmPickQueueRoute } from '../lib/picking/warmPickQueue';
import { phoneToAuthEmail } from '../lib/auth/phoneAuth';
import type { StockLocationCode, UserRole } from '../types';

type Role = 'sales' | 'billing' | 'picking' | 'admin' | 'partner' | null;
type AuthMode = 'supabase' | 'legacy' | null;

export interface PhoneLoginResult {
  success: boolean;
  error?: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  authMode: AuthMode;
  role: Role;
  userName: string | null;
  userId: number | null;
  branch: StockLocationCode | null;
  partnerCompanyId: number | null;
  adminUnlocked: boolean;
  session: Session | null;
  supabaseUser: SupabaseUser | null;
  authReady: boolean;
  loginWithPhone: (phone: string, pin: string) => Promise<PhoneLoginResult>;
  /** Legacy shared access code (transition period). */
  login: (code: string) => Promise<boolean>;
  unlockAdmin: (code: string) => boolean;
  selectRole: (role: NonNullable<Role>, name?: string, partnerCompanyId?: number) => void;
  logout: () => Promise<void>;
  switchRole: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LS_KEYS = {
  authenticated: 'paspl_authenticated',
  authMode: 'paspl_authMode',
  role: 'paspl_role',
  userName: 'paspl_userName',
  userId: 'paspl_userId',
  branch: 'paspl_branch',
  partnerCompanyId: 'paspl_partnerCompanyId',
  adminUnlocked: 'paspl_admin_unlocked',
} as const;

/** Admin section passcode (separate from app access code). */
const ADMIN_PASSCODE = '0807';

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

function loadFromStorage() {
  const userIdStr = safeLocalStorageGet(LS_KEYS.userId);
  const partnerIdStr = safeLocalStorageGet(LS_KEYS.partnerCompanyId);
  const authModeRaw = safeLocalStorageGet(LS_KEYS.authMode);
  return {
    isAuthenticated: safeLocalStorageGet(LS_KEYS.authenticated) === 'true',
    authMode: (authModeRaw === 'supabase' || authModeRaw === 'legacy' ? authModeRaw : null) as AuthMode,
    role: (safeLocalStorageGet(LS_KEYS.role) as Role) || null,
    userName: safeLocalStorageGet(LS_KEYS.userName),
    userId: userIdStr ? parseInt(userIdStr, 10) : null,
    branch: (safeLocalStorageGet(LS_KEYS.branch) as StockLocationCode | null) || null,
    partnerCompanyId: partnerIdStr ? parseInt(partnerIdStr, 10) : null,
    adminUnlocked: safeSessionStorageGet(LS_KEYS.adminUnlocked) === 'true',
  };
}

interface UserProfileRow {
  id: number;
  full_name: string;
  role: UserRole;
  stock_location_code: StockLocationCode | null;
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element | null {
  const initial = loadFromStorage();
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(initial.isAuthenticated);
  const [authMode, setAuthMode] = useState<AuthMode>(initial.authMode);
  const [role, setRole] = useState<Role>(initial.role);
  const [userName, setUserName] = useState<string | null>(initial.userName);
  const [userId, setUserId] = useState<number | null>(initial.userId);
  const [branch, setBranch] = useState<StockLocationCode | null>(initial.branch);
  const [partnerCompanyId, setPartnerCompanyId] = useState<number | null>(
    initial.partnerCompanyId,
  );
  const [adminUnlocked, setAdminUnlocked] = useState(initial.adminUnlocked);
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);

  const applySupabaseProfile = useCallback((profile: UserProfileRow, nextSession: Session) => {
    setSession(nextSession);
    setSupabaseUser(nextSession.user);
    setAuthMode('supabase');
    setIsAuthenticated(true);
    setRole(profile.role as Role);
    setUserName(profile.full_name);
    setUserId(profile.id);
    setBranch(profile.stock_location_code);
    setPartnerCompanyId(null);

    safeLocalStorageSet(LS_KEYS.authenticated, 'true');
    safeLocalStorageSet(LS_KEYS.authMode, 'supabase');
    safeLocalStorageSet(LS_KEYS.role, profile.role);
    safeLocalStorageSet(LS_KEYS.userName, profile.full_name);
    safeLocalStorageSet(LS_KEYS.userId, String(profile.id));
    if (profile.stock_location_code) {
      safeLocalStorageSet(LS_KEYS.branch, profile.stock_location_code);
    } else {
      safeLocalStorageRemove(LS_KEYS.branch);
    }
    safeLocalStorageRemove(LS_KEYS.partnerCompanyId);
  }, []);

  const clearAuthState = useCallback(() => {
    setIsAuthenticated(false);
    setAuthMode(null);
    setRole(null);
    setUserName(null);
    setUserId(null);
    setBranch(null);
    setPartnerCompanyId(null);
    setAdminUnlocked(false);
    setSession(null);
    setSupabaseUser(null);

    safeLocalStorageRemove(LS_KEYS.authenticated);
    safeLocalStorageRemove(LS_KEYS.authMode);
    safeLocalStorageRemove(LS_KEYS.role);
    safeLocalStorageRemove(LS_KEYS.userName);
    safeLocalStorageRemove(LS_KEYS.userId);
    safeLocalStorageRemove(LS_KEYS.branch);
    safeLocalStorageRemove(LS_KEYS.partnerCompanyId);
    safeSessionStorageRemove(LS_KEYS.adminUnlocked);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateFromSession = async (nextSession: Session | null) => {
      if (!nextSession?.user) return false;

      const { data: profile, error } = await supabase
        .from('users')
        .select('id, full_name, role, stock_location_code')
        .eq('auth_id', nextSession.user.id)
        .maybeSingle();

      if (cancelled) return false;
      if (error || !profile) {
        console.error('users lookup by auth_id', error);
        await supabase.auth.signOut();
        return false;
      }

      applySupabaseProfile(profile as UserProfileRow, nextSession);
      void supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', profile.id);
      return true;
    };

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (data.session) {
        await hydrateFromSession(data.session);
      }
      setAuthReady(true);
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      if (nextSession) {
        void hydrateFromSession(nextSession);
      } else if (authMode === 'supabase') {
        clearAuthState();
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [applySupabaseProfile, authMode, clearAuthState]);

  useEffect(() => {
    if (!userName || !role || role === 'admin' || role === 'partner' || userId !== null) return;
    if (authMode === 'supabase') return;

    let cancelled = false;
    void supabase
      .from('users')
      .select('id, full_name, stock_location_code')
      .eq('role', role)
      .eq('is_active', true)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const needle = userName.trim().toLowerCase();
        const match = (rows ?? []).find((u) => u.full_name.trim().toLowerCase() === needle);
        if (match?.id != null) {
          setUserId(match.id);
          safeLocalStorageSet(LS_KEYS.userId, String(match.id));
          if (match.stock_location_code) {
            setBranch(match.stock_location_code as StockLocationCode);
            safeLocalStorageSet(LS_KEYS.branch, match.stock_location_code);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authMode, userName, role, userId]);

  useEffect(() => {
    if (role !== 'picking') return;
    warmPickQueueRoute(userId, branch);
  }, [branch, role, userId]);

  const loginWithPhone = useCallback(
    async (phone: string, pin: string): Promise<PhoneLoginResult> => {
      const email = phoneToAuthEmail(phone);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pin });

      if (error || !data.session) {
        return { success: false, error: error?.message ?? 'Sign in failed' };
      }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, full_name, role, stock_location_code')
        .eq('auth_id', data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        return { success: false, error: 'User profile not found' };
      }

      applySupabaseProfile(profile as UserProfileRow, data.session);
      void supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', profile.id);

      return { success: true };
    },
    [applySupabaseProfile],
  );

  const login = useCallback(async (code: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'access_code')
      .single();

    if (error || !data) return false;

    if (data.value === code) {
      setIsAuthenticated(true);
      setAuthMode('legacy');
      safeLocalStorageSet(LS_KEYS.authenticated, 'true');
      safeLocalStorageSet(LS_KEYS.authMode, 'legacy');
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

  const selectRole = useCallback(
    (newRole: NonNullable<Role>, name?: string, companyId?: number) => {
      const resolvedName = name || null;
      setRole(newRole);
      setUserName(resolvedName);
      safeLocalStorageSet(LS_KEYS.role, newRole);
      if (resolvedName) {
        safeLocalStorageSet(LS_KEYS.userName, resolvedName);
      } else {
        safeLocalStorageRemove(LS_KEYS.userName);
      }

      if (newRole === 'partner') {
        const id = companyId ?? null;
        setPartnerCompanyId(id);
        setUserId(null);
        setBranch(null);
        safeLocalStorageRemove(LS_KEYS.userId);
        safeLocalStorageRemove(LS_KEYS.branch);
        if (id !== null) {
          safeLocalStorageSet(LS_KEYS.partnerCompanyId, String(id));
        } else {
          safeLocalStorageRemove(LS_KEYS.partnerCompanyId);
        }
        return;
      }

      setPartnerCompanyId(null);
      safeLocalStorageRemove(LS_KEYS.partnerCompanyId);

      if (resolvedName) {
        supabase
          .from('users')
          .select('id, full_name, stock_location_code')
          .eq('role', newRole)
          .eq('is_active', true)
          .then(({ data: rows, error }) => {
            if (error) {
              console.error('users lookup', error);
              setUserId(null);
              setBranch(null);
              safeLocalStorageRemove(LS_KEYS.userId);
              safeLocalStorageRemove(LS_KEYS.branch);
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
            const nextBranch = (match?.stock_location_code as StockLocationCode | null) ?? null;
            setBranch(nextBranch);
            if (nextBranch) {
              safeLocalStorageSet(LS_KEYS.branch, nextBranch);
            } else {
              safeLocalStorageRemove(LS_KEYS.branch);
            }
          });
      } else {
        setUserId(null);
        setBranch(null);
        safeLocalStorageRemove(LS_KEYS.userId);
        safeLocalStorageRemove(LS_KEYS.branch);
      }
    },
    [],
  );

  const switchRole = useCallback(() => {
    setRole(null);
    setUserName(null);
    setUserId(null);
    setBranch(null);
    setPartnerCompanyId(null);
    setAdminUnlocked(false);
    safeSessionStorageRemove(LS_KEYS.adminUnlocked);
    safeLocalStorageRemove(LS_KEYS.role);
    safeLocalStorageRemove(LS_KEYS.userName);
    safeLocalStorageRemove(LS_KEYS.userId);
    safeLocalStorageRemove(LS_KEYS.branch);
    safeLocalStorageRemove(LS_KEYS.partnerCompanyId);
  }, []);

  const logout = useCallback(async () => {
    const draftName = safeLocalStorageGet(LS_KEYS.userName);
    const draftIdStr = safeLocalStorageGet(LS_KEYS.userId);
    const parsedId = draftIdStr ? parseInt(draftIdStr, 10) : NaN;
    const draftUserId = Number.isNaN(parsedId) ? null : parsedId;
    clearCartDraft(draftName, draftUserId);

    if (authMode === 'supabase' || session) {
      await supabase.auth.signOut();
    }
    clearAuthState();
  }, [authMode, clearAuthState, session]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        authMode,
        role,
        userName,
        userId,
        branch,
        partnerCompanyId,
        adminUnlocked,
        session,
        supabaseUser,
        authReady,
        loginWithPhone,
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
