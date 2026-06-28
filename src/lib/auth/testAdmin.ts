import { normalizePhoneInput } from './phoneAuth';

/** Test admin credentials — real Supabase auth with role switching for QA. */
export const TEST_ADMIN_PHONE = '9300944311';
export const TEST_ADMIN_PIN = '0807';
export const TEST_ADMIN_NAME = 'Test Admin';

const SESSION_KEY = 'paspl_test_admin';

export function isTestAdminPhone(phone: string): boolean {
  return normalizePhoneInput(phone) === TEST_ADMIN_PHONE;
}

export function markTestAdminSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, 'true');
  } catch {
    // ignore
  }
}

export function clearTestAdminSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function isTestAdminSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export function canSwitchRoles(): boolean {
  return isTestAdminSession();
}
