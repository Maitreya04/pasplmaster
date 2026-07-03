import { supabase } from '../supabase/client';

export type EnsurePickingClaimResult = {
  claimId: number | null;
  error?: string;
};

/**
 * Ensures the picker holds an active picking claim before a server mutation.
 * Reclaims for the same user when the prior claim id is missing or expired.
 */
export async function ensurePickingClaim(options: {
  orderId: number;
  userId: number;
  claimId?: number | null;
}): Promise<EnsurePickingClaimResult> {
  const { data, error } = await supabase.rpc('claim_order', {
    p_order_id: options.orderId,
    p_stage: 'picking',
    p_user_id: options.userId,
  });

  if (error) {
    return { claimId: options.claimId ?? null, error: error.message };
  }

  const result = data as {
    success?: boolean;
    claim_id?: number;
    reason?: string;
    claimed_by?: string;
  };

  if (result.success && result.claim_id) {
    return { claimId: result.claim_id };
  }

  return {
    claimId: options.claimId ?? null,
    error:
      result.reason === 'already_claimed'
        ? `Already claimed by ${result.claimed_by ?? 'another user'}`
        : result.reason ?? 'claim_failed',
  };
}
