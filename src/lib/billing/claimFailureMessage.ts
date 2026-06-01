/** Operator-facing copy for claim_order / useWorkClaim failures. */
export function billingClaimFailureMessage(reason?: string | null): string {
  const raw = reason?.trim() || 'unknown error';
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Can't reach the server — check your network and that Supabase is running.";
  }
  return raw;
}
