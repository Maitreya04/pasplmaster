/** Test-admin credentials are no longer shipped in the client. */

const SESSION_KEY = 'paspl_test_admin';

export function isTestAdminPhone(phone: string): boolean {
  void phone;
  return false;
}

export function markTestAdminSession(): void {}

export function clearTestAdminSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function isTestAdminSession(): boolean {
  return false;
}

export function canSwitchRoles(): boolean {
  return false;
}
