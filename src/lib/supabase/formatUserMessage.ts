/**
 * Supabase client errors (RPC, PostgREST, etc.) are often plain objects with
 * `message` / `details` / `hint`, not Error instances — avoid "[object Object]".
 */
export function formatSupabaseUserMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint]
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    if (parts.length > 0) return [...new Set(parts)].join(' · ');
    if (typeof o.code === 'string' && o.code) return o.code;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return 'Something went wrong';
  }
}
