const OFFLINE_SESSION_KEY = 'paspl-device-offline';

/** True when the browser reports no network (airplane mode, etc.). */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Remember that the device went offline — `navigator.onLine` lies on some mobile PWAs. */
export function markDeviceOffline(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(OFFLINE_SESSION_KEY, '1');
  } catch {
    // Private mode / quota — ignore.
  }
}

export function markDeviceOnline(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(OFFLINE_SESSION_KEY);
  } catch {
    // ignore
  }
}

function hasOfflineSessionFlag(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(OFFLINE_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Use at submit time — reads live browser state + offline session flag. */
export function shouldQueueSalesOrderLocally(): boolean {
  return isBrowserOffline() || hasOfflineSessionFlag();
}
