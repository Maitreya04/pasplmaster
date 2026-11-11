import type { Session } from '@supabase/supabase-js';
import { supabase } from './client';
import { isSessionLocallyValid } from './sessionValidity';

export { isSessionLocallyValid };

/**
 * Wait until the Supabase client has finished restoring any persisted session
 * from storage, then return the current session (or null if logged out).
 *
 * Authenticated REST warmers must await this before querying tables that no
 * longer allow anon access — otherwise the request goes out with the anon JWT
 * and fails with 401.
 */
export async function getRestoredSession(): Promise<Session | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session ?? null;
  } catch {
    return null;
  }
}
