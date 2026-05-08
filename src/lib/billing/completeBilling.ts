import { supabase } from '../supabase/client';

interface ClaimResult {
  success: boolean;
  claim_id?: number;
  reason?: string;
  claimed_by?: string;
}

interface CompleteBillingResult {
  success?: boolean;
  reason?: string;
}

interface CompleteBillingOptions {
  orderId: number;
  claimId: number | null;
  userId: number | null;
  isResolvingFlags?: boolean;
  claim: () => Promise<ClaimResult>;
}

function billingApprovalError(result: CompleteBillingResult | null | undefined): Error {
  const reason = result?.reason ?? 'complete_billing returned no success result';
  return new Error(`Billing approval failed: ${reason}`);
}

async function claimForBilling(claim: () => Promise<ClaimResult>): Promise<number> {
  const result = await claim();
  if (!result.success || !result.claim_id) {
    const owner = result.claimed_by ? ` by ${result.claimed_by}` : '';
    throw new Error(`Cannot approve. Order is not claimed${owner}. ${result.reason ?? ''}`.trim());
  }
  return result.claim_id;
}

async function callCompleteBilling(
  orderId: number,
  claimId: number,
  userId: number,
  isResolvingFlags: boolean,
): Promise<CompleteBillingResult> {
  const { data, error } = await supabase.rpc('complete_billing', {
    p_order_id: orderId,
    p_claim_id: claimId,
    p_user_id: userId,
    p_is_resolving_flags: isResolvingFlags,
  });

  if (error) throw error;
  return data as CompleteBillingResult;
}

export async function completeBillingWithClaim(options: CompleteBillingOptions): Promise<void> {
  const { orderId, userId, claim, isResolvingFlags = false } = options;
  if (!userId) throw new Error('Cannot approve. Missing billing user.');

  let activeClaimId = options.claimId ?? await claimForBilling(claim);
  let result = await callCompleteBilling(orderId, activeClaimId, userId, isResolvingFlags);

  if (result?.success) return;

  if (result?.reason === 'No active billing claim found') {
    activeClaimId = await claimForBilling(claim);
    result = await callCompleteBilling(orderId, activeClaimId, userId, isResolvingFlags);
    if (result?.success) return;
  }

  throw billingApprovalError(result);
}
