/**
 * Tiny typed IndexedDB key/value store.
 *
 * Used to persist query caches across reloads so we do not re-pay
 * the egress cost of bootstrapping the items catalog every session.
 *
 * Intentionally avoids a dependency: only one tiny store and three ops.
 */

const DB_NAME = 'paspl-cache';
const STORE_NAME = 'kv';
const DB_VERSION = 1;
const IDB_TIMEOUT_MS = 300;

let dbPromise: Promise<IDBDatabase> | null = null;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), IDB_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function localStorageKey(key: string): string {
  return `paspl-cache:${key}`;
}

function getLocalStorageValue<T>(key: string): T | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(localStorageKey(key));
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function setLocalStorageValue<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(localStorageKey(key), JSON.stringify(value));
  } catch {
    // Large cache entries may exceed localStorage quota; IndexedDB remains best effort.
  }
}

function delLocalStorageValue(key: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(localStorageKey(key));
  } catch {
    // ignore
  }
}

function getDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
      req.onblocked = () => reject(new Error('IDB open blocked'));
    });
  }
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const localValue = getLocalStorageValue<T>(key);
  if (localValue !== undefined) return localValue;

  try {
    const db = await withTimeout(getDb(), 'IDB open');
    return await withTimeout(new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error ?? new Error('IDB get failed'));
    }), 'IDB get');
  } catch {
    return getLocalStorageValue<T>(key);
  }
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  // Keep small, critical queues available even if IndexedDB stalls on mobile.
  setLocalStorageValue(key, value);

  try {
    const db = await withTimeout(getDb(), 'IDB open');
    await withTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB set failed'));
    }), 'IDB set');
  } catch {
    // IndexedDB unavailable (private mode, quota, etc.) — treat persistence
    // as best-effort; localStorage was already attempted above.
  }
}

export async function idbDel(key: string): Promise<void> {
  try {
    const db = await withTimeout(getDb(), 'IDB open');
    await withTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IDB del failed'));
    }), 'IDB delete');
  } catch {
    // ignore
  } finally {
    delLocalStorageValue(key);
  }
}
