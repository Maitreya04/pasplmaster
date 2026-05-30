import type { FulfillmentPath } from '../../types';
import { supabase } from '../supabase/client';
import { formatSupabaseUserMessage } from '../supabase/formatUserMessage';

interface ClaimResult {
  success: boolean;
  claim_id?: number;
  reason?: string;
  claimed_by?: string;
}

export interface CompleteBillingResult {
  success?: boolean;
  reason?: string;
  fulfillment_path?: FulfillmentPath;
  requested_fulfillment_path?: FulfillmentPath;
  pick_path_downgraded?: boolean;
}

interface CompleteBillingOptions {
  orderId: number;
  claimId: number | null;
  userId: number | null;
  isResolvingFlags?: boolean;
  fulfillmentPath?: FulfillmentPath;
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
  fulfillmentPath: FulfillmentPath,
): Promise<CompleteBillingResult> {
  const { data, error } = await supabase.rpc('complete_billing', {
    p_order_id: orderId,
    p_claim_id: claimId,
    p_user_id: userId,
    p_is_resolving_flags: isResolvingFlags,
    p_fulfillment_path: fulfillmentPath,
  });

  if (error) throw new Error(formatSupabaseUserMessage(error));
  return data as CompleteBillingResult;
}

export async function completeBillingWithClaim(
  options: CompleteBillingOptions,
): Promise<CompleteBillingResult> {
  const {
    orderId,
    userId,
    claim,
    isResolvingFlags = false,
    fulfillmentPath = 'warehouse_pick',
  } = options;
  if (!userId) throw new Error('Cannot approve. Missing billing user.');

  let activeClaimId = options.claimId ?? await claimForBilling(claim);
  let result = await callCompleteBilling(
    orderId,
    activeClaimId,
    userId,
    isResolvingFlags,
    fulfillmentPath,
  );
  if (result?.success) return result;

  // Re-claim once (stale React claim id, heartbeat timeout, tab backgrounded, etc.)
  activeClaimId = await claimForBilling(claim);
  result = await callCompleteBilling(
    orderId,
    activeClaimId,
    userId,
    isResolvingFlags,
    fulfillmentPath,
  );
  if (result?.success) return result;

  throw billingApprovalError(result);
}
