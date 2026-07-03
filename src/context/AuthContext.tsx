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
import { isSupabaseAuthError, isTransientSupabaseError } from '../lib/supabase/authError';
import {
  clearTestAdminSession,
  isTestAdminPhone,
  markTestAdminSession,
} from '../lib/auth/testAdmin';
import type { StockLocationCode, UserRole } from '../types';

type Role = 'sales' | 'billing' | 'picking' | 'admin' | 'partner' | null;
type AuthMode = 'supabase' | null;

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
  authRecoveryMessage: string | null;
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
  recoverLogin: (message?: string) => Promise<void>;
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
const USER_PROFILE_SELECT = 'id, full_name, role, stock_location_code, phone, is_active';
const SESSION_EXPIRED_MESSAGE = 'Your previous login expired. Enter your PIN to continue.';
const SESSION_VERIFY_FAILED_MESSAGE =
  'We could not verify your saved login. Enter your PIN again to reconnect.';
const PROFILE_MISSING_MESSAGE =
  'This login is no longer linked to an active staff profile. Sign in again or contact admin.';

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

function clearLegacySessionStorage(): void {
  safeLocalStorageRemove(LS_KEYS.authenticated);
  safeLocalStorageRemove(LS_KEYS.authMode);
  safeLocalStorageRemove(LS_KEYS.role);
  safeLocalStorageRemove(LS_KEYS.userName);
  safeLocalStorageRemove(LS_KEYS.userId);
  safeLocalStorageRemove(LS_KEYS.branch);
  safeLocalStorageRemove(LS_KEYS.partnerCompanyId);
  safeSessionStorageRemove(LS_KEYS.adminUnlocked);
  safeSessionStorageRemove(LS_KEYS.impersonation);
}

function loadFromStorage() {
  const authModeRaw = safeLocalStorageGet(LS_KEYS.authMode);
  if (authModeRaw === 'legacy') {
    clearLegacySessionStorage();
    return {
      isAuthenticated: false,
      authMode: null as AuthMode,
      role: null as Role,
      userName: null,
      userId: null,
      branch: null as StockLocationCode | null,
      partnerCompanyId: null,
      adminUnlocked: false,
      impersonation: null,
    };
  }

  const userIdStr = safeLocalStorageGet(LS_KEYS.userId);
  const partnerIdStr = safeLocalStorageGet(LS_KEYS.partnerCompanyId);
  const isSupabaseSession =
    authModeRaw === 'supabase' && safeLocalStorageGet(LS_KEYS.authenticated) === 'true';
  return {
    isAuthenticated: isSupabaseSession,
    authMode: isSupabaseSession ? ('supabase' as AuthMode) : null,
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
  is_active?: boolean | null;
}

function withVerifiedUser(nextSession: Session, user: SupabaseUser): Session {
  return {
    ...nextSession,
    user,
  };
}

function formatPhoneLoginError(message: string | undefined): string {
  if (!message) return 'Sign in failed. Check your connection and try again.';
  if (/invalid login credentials/i.test(message)) return 'Phone number or PIN is incorrect.';
  if (/network|fetch|failed to fetch/i.test(message)) {
    return 'Could not reach the server. Check the connection and try again.';
  }
  return message;
}

function getCachedProfileForGrace(initial: ReturnType<typeof loadFromStorage>): UserProfileRow | null {
  if (
    initial.authMode !== 'supabase' ||
    !initial.isAuthenticated ||
    !initial.role ||
    initial.role === 'partner' ||
    !initial.userName ||
    initial.userId == null
  ) {
    return null;
  }

  return {
    id: initial.userId,
    full_name: initial.userName,
    role: initial.role,
    stock_location_code: initial.branch,
    phone: null,
    is_active: true,
  };
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
  const [initial] = useState(() => {
    const stored = loadFromStorage();
    return {
      ...stored,
      hadCachedSupabaseAuth: stored.authMode === 'supabase' && stored.isAuthenticated,
    };
  });
  const [authReady, setAuthReady] = useState(false);
  const [authRecoveryMessage, setAuthRecoveryMessage] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [actualRole, setActualRole] = useState<Role>(null);
  const [actualUserName, setActualUserName] = useState<string | null>(null);
  const [actualUserId, setActualUserId] = useState<number | null>(null);
  const [actualBranch, setActualBranch] = useState<StockLocationCode | null>(null);
  const [impersonation, setImpersonation] = useState<StoredImpersonation | null>(null);
  const [partnerCompanyId, setPartnerCompanyId] = useState<number | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [testAdminSession, setTestAdminSession] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const authModeRef = useRef<AuthMode>(null);

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
    authModeRef.current = 'supabase';
    setIsAuthenticated(true);
    setAuthRecoveryMessage(null);
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

  const clearAuthState = useCallback((recoveryMessage: string | null = null) => {
    setIsAuthenticated(false);
    setAuthMode(null);
    authModeRef.current = null;
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
    setAuthRecoveryMessage(recoveryMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateFromSession = async (nextSession: Session | null) => {
      if (!nextSession?.user) {
        return { success: false, message: SESSION_EXPIRED_MESSAGE };
      }

      const { data: verifiedUserData, error: verifiedUserError } = await supabase.auth.getUser();
      if (cancelled) return { success: false, message: null };
      if (
        verifiedUserError ||
        !verifiedUserData.user ||
        verifiedUserData.user.id !== nextSession.user.id
      ) {
        if (verifiedUserError) console.error('auth user verification failed', verifiedUserError);
        if (verifiedUserError && isTransientSupabaseError(verifiedUserError)) {
          const cachedProfile = getCachedProfileForGrace(initial);
          if (cachedProfile) {
            applySupabaseProfile(cachedProfile, nextSession);
            return { success: true, message: null };
          }
          return { success: false, message: null };
        }
        if (verifiedUserError && !isSupabaseAuthError(verifiedUserError)) {
          return { success: false, message: SESSION_VERIFY_FAILED_MESSAGE };
        }
        try {
          await supabase.auth.signOut();
        } catch {
          // Local auth state is cleared by the caller.
        }
        return { success: false, message: SESSION_VERIFY_FAILED_MESSAGE };
      }

      const verifiedSession = withVerifiedUser(nextSession, verifiedUserData.user);

      const { data: profile, error } = await supabase
        .from('users')
        .select(USER_PROFILE_SELECT)
        .eq('auth_id', verifiedSession.user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (cancelled) return { success: false, message: null };
      if (error) {
        console.error('users lookup by auth_id', error);
        if (isTransientSupabaseError(error)) {
          const cachedProfile = getCachedProfileForGrace(initial);
          if (cachedProfile) {
            applySupabaseProfile(cachedProfile, verifiedSession);
            return { success: true, message: null };
          }
          return { success: false, message: null };
        }
        return { success: false, message: SESSION_VERIFY_FAILED_MESSAGE };
      }
      if (!profile) {
        console.error('users lookup by auth_id: active profile missing for auth user');
        await supabase.auth.signOut();
        return { success: false, message: PROFILE_MISSING_MESSAGE };
      }

      applySupabaseProfile(profile as UserProfileRow, verifiedSession);
      if (isTestAdminPhone(profile.phone ?? '')) {
        activateTestAdminSession(setTestAdminSession);
        unlockAdminForTesting(setAdminUnlocked);
      }
      void supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', profile.id);
      return { success: true, message: null };
    };

    void (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error) {
        console.error('auth session lookup failed', error);
        if (initial.hadCachedSupabaseAuth) {
          clearAuthState(SESSION_VERIFY_FAILED_MESSAGE);
        }
        setAuthReady(true);
        return;
      }

      if (data.session) {
        const result = await hydrateFromSession(data.session);
        if (!cancelled && !result.success && result.message) {
          clearAuthState(result.message);
        }
      } else if (initial.hadCachedSupabaseAuth) {
        clearAuthState(SESSION_EXPIRED_MESSAGE);
      }
      setAuthReady(true);
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return;
      if (nextSession) {
        if (event === 'INITIAL_SESSION') return;
        if (event === 'TOKEN_REFRESHED' && authModeRef.current === 'supabase') {
          setSession(nextSession);
          setSupabaseUser(nextSession.user);
          return;
        }
        window.setTimeout(() => {
          if (!cancelled) {
            void hydrateFromSession(nextSession).then((result) => {
              if (!cancelled && !result.success && result.message) {
                clearAuthState(result.message);
              }
            });
          }
        }, 0);
      } else if (authModeRef.current === 'supabase') {
        clearAuthState();
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [applySupabaseProfile, clearAuthState, initial]);

  useEffect(() => {
    if (role !== 'picking') return;
    warmPickQueueRoute(userId, branch);
  }, [branch, role, userId]);

  const loginWithPhone = useCallback(
    async (phone: string, pin: string): Promise<PhoneLoginResult> => {
      setAuthRecoveryMessage(null);
      const email = phoneToAuthEmail(phone);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pin });

      if (error || !data.session) {
        return { success: false, error: formatPhoneLoginError(error?.message) };
      }

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select(USER_PROFILE_SELECT)
        .eq('auth_id', data.user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        if (profileError) console.error('users lookup by auth_id after login', profileError);
        return { success: false, error: PROFILE_MISSING_MESSAGE };
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

  const recoverLogin = useCallback(
    async (message = SESSION_VERIFY_FAILED_MESSAGE): Promise<void> => {
      if (authModeRef.current === 'supabase' || session) {
        try {
          await supabase.auth.signOut();
        } catch {
          // Local auth state is still cleared below so the user can sign in again.
        }
      }
      clearAuthState(message);
    },
    [clearAuthState, session],
  );

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
        authRecoveryMessage,
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
        recoverLogin,
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
