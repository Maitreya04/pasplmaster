import type { Session } from '@supabase/supabase-js';

/** True when a restored session exists and its access token is not past expiry. */
export function isSessionLocallyValid(session: Session | null | undefined): boolean {
  if (!session?.access_token) return false;
  if (session.expires_at == null) return true;
  return session.expires_at * 1000 > Date.now();
}
