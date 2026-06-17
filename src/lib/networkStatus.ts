/** True when the browser reports no network (airplane mode, etc.). */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Quick check that Supabase is reachable before attempting a slow RPC.
 * Fails fast when the device is offline or the network is dead.
 */
export async function canReachSupabase(timeoutMs = 1_200): Promise<boolean> {
  if (isBrowserOffline()) return false;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return false;

  const endpoint = `${url.replace(/\/$/, '')}/auth/v1/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
