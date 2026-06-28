import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase/client';
import { clearCartDraft } from '../lib/cartDraftStorage';
import { warmPickQueueRoute } from '../lib/picking/warmPickQueue';
import { phoneToAuthEmail, normalizePhoneInput, saveDeviceProfile } from '../lib/auth/phoneAuth';
import {
  clearTestAdminSession,
  isTestAdminPhone,
  isTestAdminSession,
  markTestAdminSession,
} from '../lib/auth/testAdmin';
import type { StockLocationCode, UserRole } from '../types';

type Role = 'sales' | 'billing' | 'picking' | 'admin' | 'partner' | null;
type AuthMode = 'supabase' | 'legacy' | null;

export interface PhoneLoginResult {
  success: boolean;
  error?: string;
}

export interface ImpersonationTarget {
  userId: number;
  userName: string;
  role: Exclude<UserRole, 'admin' | 'partner'>;
  branch: StockLocationCode | null;
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
  isImpersonating: boolean;
  actualRole: Role;
  actualUserId: number | null;
  actualUserName: string | null;
  loginWithPhone: (phone: string, pin: string) => Promise<PhoneLoginResult>;
  /** Legacy shared access code (transition period). */
  login: (code: string) => Promise<boolean>;
  unlockAdmin: (code: string) => boolean;
  selectRole: (role: NonNullable<Role>, name?: string, partnerCompanyId?: number) => void;
  startImpersonation: (target: ImpersonationTarget) => boolean;
  exitImpersonation: () => void;
  logout: () => Promise<void>;
  switchRole: () => void;
  canSwitchRoles: boolean;
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
  impersonation: 'paspl_impersonation',
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

interface StoredImpersonation {
  userId: number;
  userName: string;
  role: Exclude<UserRole, 'admin' | 'partner'>;
  branch: StockLocationCode | null;
}

function loadImpersonationFromStorage(): StoredImpersonation | null {
  const raw = safeSessionStorageGet(LS_KEYS.impersonation);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredImpersonation;
    if (
      typeof parsed.userId === 'number' &&
      typeof parsed.userName === 'string' &&
      typeof parsed.role === 'string'
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
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
    impersonation: loadImpersonationFromStorage(),
  };
}

interface UserProfileRow {
  id: number;
  full_name: string;
  role: UserRole;
  stock_location_code: StockLocationCode | null;
  phone: string | null;
}

function activateTestAdminSession(setTestAdminSession: (value: boolean) => void): void {
  markTestAdminSession();
  setTestAdminSession(true);
}

function clearSelectedRoleForTesting(
  setters: {
    setActualRole: (value: Role) => void;
    setActualUserName: (value: string | null) => void;
    setActualUserId: (value: number | null) => void;
    setActualBranch: (value: StockLocationCode | null) => void;
    setPartnerCompanyId: (value: number | null) => void;
    setImpersonation: (value: StoredImpersonation | null) => void;
  },
): void {
  setters.setActualRole(null);
  setters.setActualUserName(null);
  setters.setActualUserId(null);
  setters.setActualBranch(null);
  setters.setPartnerCompanyId(null);
  setters.setImpersonation(null);
  safeLocalStorageRemove(LS_KEYS.role);
  safeLocalStorageRemove(LS_KEYS.userName);
  safeLocalStorageRemove(LS_KEYS.userId);
  safeLocalStorageRemove(LS_KEYS.branch);
  safeLocalStorageRemove(LS_KEYS.partnerCompanyId);
  safeSessionStorageRemove(LS_KEYS.impersonation);
}

function unlockAdminForTesting(setAdminUnlocked: (value: boolean) => void): void {
  setAdminUnlocked(true);
  safeSessionStorageSet(LS_KEYS.adminUnlocked, 'true');
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element | null {
  const initial = loadFromStorage();
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(initial.isAuthenticated);
  const [authMode, setAuthMode] = useState<AuthMode>(initial.authMode);
  const [actualRole, setActualRole] = useState<Role>(initial.role);
  const [actualUserName, setActualUserName] = useState<string | null>(initial.userName);
  const [actualUserId, setActualUserId] = useState<number | null>(initial.userId);
  const [actualBranch, setActualBranch] = useState<StockLocationCode | null>(initial.branch);
  const [impersonation, setImpersonation] = useState<StoredImpersonation | null>(
    initial.impersonation,
  );
  const [partnerCompanyId, setPartnerCompanyId] = useState<number | null>(
    initial.partnerCompanyId,
  );
  const [adminUnlocked, setAdminUnlocked] = useState(initial.adminUnlocked);
  const [testAdminSession, setTestAdminSession] = useState(isTestAdminSession);
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const authModeRef = useRef<AuthMode>(initial.authMode);

  useEffect(() => {
    authModeRef.current = authMode;
  }, [authMode]);

  const role = impersonation ? (impersonation.role as Role) : actualRole;
  const userName = impersonation ? impersonation.userName : actualUserName;
  const userId = impersonation ? impersonation.userId : actualUserId;
  const branch = impersonation ? impersonation.branch : actualBranch;
  const isImpersonating = impersonation !== null;

  const persistProfile = useCallback((profile: UserProfileRow) => {
    setActualRole(profile.role as Role);
    setActualUserName(profile.full_name);
    setActualUserId(profile.id);
    setActualBranch(profile.stock_location_code);

    safeLocalStorageSet(LS_KEYS.role, profile.role);
    safeLocalStorageSet(LS_KEYS.userName, profile.full_name);
    safeLocalStorageSet(LS_KEYS.userId, String(profile.id));
    if (profile.stock_location_code) {
      safeLocalStorageSet(LS_KEYS.branch, profile.stock_location_code);
    } else {
      safeLocalStorageRemove(LS_KEYS.branch);
    }
  }, []);

  const applySupabaseProfile = useCallback((profile: UserProfileRow, nextSession: Session) => {
    const storedImpersonation = loadImpersonationFromStorage();
    const canRestoreImpersonation =
      profile.role === 'admin' &&
      storedImpersonation !== null &&
      safeSessionStorageGet(LS_KEYS.adminUnlocked) === 'true';

    setSession(nextSession);
    setSupabaseUser(nextSession.user);
    setAuthMode('supabase');
    setIsAuthenticated(true);
    setPartnerCompanyId(null);
    persistProfile(profile);

    if (canRestoreImpersonation) {
      setImpersonation(storedImpersonation);
    } else {
      setImpersonation(null);
      safeSessionStorageRemove(LS_KEYS.impersonation);
    }

    safeLocalStorageSet(LS_KEYS.authenticated, 'true');
    safeLocalStorageSet(LS_KEYS.authMode, 'supabase');
    safeLocalStorageRemove(LS_KEYS.partnerCompanyId);
  }, [persistProfile]);

  const clearAuthState = useCallback(() => {
    setIsAuthenticated(false);
    setAuthMode(null);
    setActualRole(null);
    setActualUserName(null);
    setActualUserId(null);
    setActualBranch(null);
    setImpersonation(null);
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
    safeSessionStorageRemove(LS_KEYS.impersonation);
    clearTestAdminSession();
    setTestAdminSession(false);
  }, []);

  // Legacy access-code sessions must not keep a Supabase JWT — branch RLS would hide billing orders.
  useEffect(() => {
    if (safeLocalStorageGet(LS_KEYS.authMode) !== 'legacy') return;
    if (safeLocalStorageGet(LS_KEYS.authenticated) !== 'true') return;
    void supabase.auth.signOut();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateFromSession = async (nextSession: Session | null) => {
      if (!nextSession?.user) return false;

      const { data: profile, error } = await supabase
        .from('users')
        .select('id, full_name, role, stock_location_code, phone')
        .eq('auth_id', nextSession.user.id)
        .maybeSingle();

      if (cancelled) return false;
      if (error) {
        console.error('users lookup by auth_id', error);
        return false;
      }
      if (!profile) {
        console.error('users lookup by auth_id: profile missing for auth user');
        await supabase.auth.signOut();
        return false;
      }

      applySupabaseProfile(profile as UserProfileRow, nextSession);
      if (isTestAdminPhone(profile.phone ?? '')) {
        activateTestAdminSession(setTestAdminSession);
        unlockAdminForTesting(setAdminUnlocked);
      }
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
      } else if (initial.authMode === 'supabase' && initial.isAuthenticated) {
        clearAuthState();
      }
      setAuthReady(true);
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (cancelled) return;
      if (nextSession) {
        window.setTimeout(() => {
          if (!cancelled) void hydrateFromSession(nextSession);
        }, 0);
      } else if (authModeRef.current === 'supabase') {
        clearAuthState();
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [applySupabaseProfile, clearAuthState]);

  useEffect(() => {
    if (!actualUserName || !actualRole || actualRole === 'admin' || actualRole === 'partner' || actualUserId !== null) return;
    if (authMode === 'supabase') return;

    let cancelled = false;
    void supabase
      .from('users')
      .select('id, full_name, stock_location_code')
      .eq('role', actualRole)
      .eq('is_active', true)
      .then(({ data: rows }) => {
        if (cancelled) return;
        const needle = actualUserName.trim().toLowerCase();
        const match = (rows ?? []).find((u) => u.full_name.trim().toLowerCase() === needle);
        if (match?.id != null) {
          setActualUserId(match.id);
          safeLocalStorageSet(LS_KEYS.userId, String(match.id));
          if (match.stock_location_code) {
            setActualBranch(match.stock_location_code as StockLocationCode);
            safeLocalStorageSet(LS_KEYS.branch, match.stock_location_code);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authMode, actualUserName, actualRole, actualUserId]);

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
        .select('id, full_name, role, stock_location_code, phone')
        .eq('auth_id', data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        return { success: false, error: 'User profile not found' };
      }

      applySupabaseProfile(profile as UserProfileRow, data.session);
      const normalizedPhone = normalizePhoneInput(phone);
      saveDeviceProfile({ phone: normalizedPhone, displayName: profile.full_name });
      if (isTestAdminPhone(normalizedPhone)) {
        activateTestAdminSession(setTestAdminSession);
        unlockAdminForTesting(setAdminUnlocked);
        clearSelectedRoleForTesting({
          setActualRole,
          setActualUserName,
          setActualUserId,
          setActualBranch,
          setPartnerCompanyId,
          setImpersonation,
        });
      }
      void supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', profile.id);

      return { success: true };
    },
    [applySupabaseProfile],
  );

  const login = useCallback(async (code: string): Promise<boolean> => {
    await supabase.auth.signOut();

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

  const startImpersonation = useCallback(
    (target: ImpersonationTarget): boolean => {
      if (actualRole !== 'admin' || !adminUnlocked) return false;
      const next: StoredImpersonation = {
        userId: target.userId,
        userName: target.userName,
        role: target.role,
        branch: target.branch,
      };
      setImpersonation(next);
      safeSessionStorageSet(LS_KEYS.impersonation, JSON.stringify(next));
      return true;
    },
    [actualRole, adminUnlocked],
  );

  const exitImpersonation = useCallback(() => {
    setImpersonation(null);
    safeSessionStorageRemove(LS_KEYS.impersonation);
  }, []);

  const selectRole = useCallback(
    (newRole: NonNullable<Role>, name?: string, companyId?: number) => {
      const resolvedName = name || null;
      setActualRole(newRole);
      setActualUserName(resolvedName);
      setImpersonation(null);
      safeSessionStorageRemove(LS_KEYS.impersonation);
      safeLocalStorageSet(LS_KEYS.role, newRole);
      if (resolvedName) {
        safeLocalStorageSet(LS_KEYS.userName, resolvedName);
      } else {
        safeLocalStorageRemove(LS_KEYS.userName);
      }

      if (newRole === 'partner') {
        const id = companyId ?? null;
        setPartnerCompanyId(id);
        setActualUserId(null);
        setActualBranch(null);
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
              setActualUserId(null);
              setActualBranch(null);
              safeLocalStorageRemove(LS_KEYS.userId);
              safeLocalStorageRemove(LS_KEYS.branch);
              return;
            }
            const needle = resolvedName.trim().toLowerCase();
            const match = (rows ?? []).find((u) => u.full_name.trim().toLowerCase() === needle);
            const id = match?.id ?? null;
            setActualUserId(id);
            if (id !== null) {
              safeLocalStorageSet(LS_KEYS.userId, String(id));
            } else {
              safeLocalStorageRemove(LS_KEYS.userId);
            }
            const nextBranch = (match?.stock_location_code as StockLocationCode | null) ?? null;
            setActualBranch(nextBranch);
            if (nextBranch) {
              safeLocalStorageSet(LS_KEYS.branch, nextBranch);
            } else {
              safeLocalStorageRemove(LS_KEYS.branch);
            }
          });
      } else {
        setActualUserId(null);
        setActualBranch(null);
        safeLocalStorageRemove(LS_KEYS.userId);
        safeLocalStorageRemove(LS_KEYS.branch);
      }
    },
    [],
  );

  const switchRole = useCallback(() => {
    setActualRole(null);
    setActualUserName(null);
    setActualUserId(null);
    setActualBranch(null);
    setPartnerCompanyId(null);
    setImpersonation(null);
    setAdminUnlocked(false);
    safeSessionStorageRemove(LS_KEYS.adminUnlocked);
    safeSessionStorageRemove(LS_KEYS.impersonation);
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
        isImpersonating,
        actualRole,
        actualUserId,
        actualUserName,
        loginWithPhone,
        login,
        unlockAdmin,
        selectRole,
        startImpersonation,
        exitImpersonation,
        logout,
        switchRole,
        canSwitchRoles: testAdminSession,
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
