import { supabase } from '../supabase/client';
import {
  bootstrapOfflinePickSession,
  createProvisionalOfflinePickSessionImmediate,
  isNetworkPickSyncError,
  persistSessionPatch,
  readOfflinePickSession,
  type OfflinePickSession,
} from '../offlinePicks';
import { startPicking, startPickingErrorMessage } from './startPicking';

export class BeginOfflinePickSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BeginOfflinePickSessionError';
    this.code = code;
  }
}

export interface BeginOfflinePickSessionInput {
  orderId: number;
  userId: number;
  pickerName: string | null;
  /** Claim from the unassigned pool before starting. Requires network. */
  fromPool?: boolean;
  /** Known claim from queue cache (assigned orders). */
  knownClaimId?: number | null;
  orderSnapshot: import('../../types').OrderWithItems;
}

export interface BeginOfflinePickSessionResult {
  session: OfflinePickSession;
  resumed: boolean;
  bootstrapPending: boolean;
}

async function claimPoolOrder(orderId: number, userId: number): Promise<number> {
  const { data, error } = await supabase.rpc('claim_order', {
    p_order_id: orderId,
    p_stage: 'picking',
    p_user_id: userId,
  });
  if (error) throw error;
  const claimResult = data as {
    success: boolean;
    reason?: string;
    claimed_by?: string;
    claim_id?: number;
  };
  if (!claimResult.success) {
    if (claimResult.reason === 'already_claimed') {
      throw new BeginOfflinePickSessionError(
        'already_claimed',
        claimResult.claimed_by ?? 'another picker',
      );
    }
    throw new BeginOfflinePickSessionError(
      claimResult.reason ?? 'claim_failed',
      claimResult.reason ?? 'Could not claim this order',
    );
  }
  if (!claimResult.claim_id) {
    throw new BeginOfflinePickSessionError('claim_failed', 'Could not claim this order');
  }
  return claimResult.claim_id;
}

/**
 * Starts (or resumes) a pick with a local-first offline session.
 *
 * Real-world flow:
 * 1. Write a provisional session to device storage immediately so the picker can enter the deck.
 * 2. Bootstrap claim → start → server prepare when network is available.
 * 3. If the network drops mid-start, the session stays in `preparing` and sync retries later.
 */
export async function beginOfflinePickSession(
  input: BeginOfflinePickSessionInput,
): Promise<BeginOfflinePickSessionResult> {
  const { orderId, userId, pickerName, fromPool = false, knownClaimId, orderSnapshot } = input;

  const existing = await readOfflinePickSession(orderId);
  if (existing && (existing.status === 'preparing' || existing.status === 'active')) {
    if (existing.status === 'preparing') {
      const bootstrapped = await bootstrapOfflinePickSession(existing);
      return {
        session: bootstrapped,
        resumed: true,
        bootstrapPending: bootstrapped.status === 'preparing',
      };
    }
    return { session: existing, resumed: true, bootstrapPending: false };
  }

  if (fromPool && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new BeginOfflinePickSessionError(
      'pool_requires_network',
      'Connect to the network to claim an unassigned order.',
    );
  }

  const startedAt = orderSnapshot.picked_at ?? new Date().toISOString();
  const provisional = createProvisionalOfflinePickSessionImmediate({
    order: {
      ...orderSnapshot,
      workflow_status: 'picking',
      picked_at: startedAt,
    },
    claimId: knownClaimId ?? null,
    userId,
    pickerName,
    fromPool,
  });

  try {
    let claimId = provisional.claimId;

    if (fromPool) {
      claimId = await claimPoolOrder(orderId, userId);
      provisional.claimId = claimId;
      await persistSessionPatch(provisional.clientPickKey, { claimId });
    }

    const startResult = await startPicking({ orderId, userId });
    if (!startResult.success) {
      throw new BeginOfflinePickSessionError(
        startResult.reason ?? 'start_failed',
        startPickingErrorMessage(startResult),
      );
    }

    const resolvedClaimId = startResult.claim_id ?? claimId;
    if (!resolvedClaimId) {
      throw new BeginOfflinePickSessionError('start_failed', 'Could not start picking');
    }

    if (resolvedClaimId !== provisional.claimId) {
      provisional.claimId = resolvedClaimId;
      await persistSessionPatch(provisional.clientPickKey, { claimId: resolvedClaimId });
    }

    const bootstrapped = await bootstrapOfflinePickSession({
      ...provisional,
      claimId: resolvedClaimId,
    });

    return {
      session: bootstrapped,
      resumed: false,
      bootstrapPending: bootstrapped.status === 'preparing',
    };
  } catch (err) {
    if (err instanceof BeginOfflinePickSessionError) throw err;
    if (isNetworkPickSyncError(err)) {
      return {
        session: provisional,
        resumed: false,
        bootstrapPending: true,
      };
    }
    throw err;
  }
}

export function beginOfflinePickSessionErrorMessage(err: unknown): string {
  if (err instanceof BeginOfflinePickSessionError) {
    if (err.code === 'already_claimed') {
      return `Already being picked by ${err.message}.`;
    }
    if (err.code === 'pool_requires_network') {
      return err.message;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Could not start picking';
}
