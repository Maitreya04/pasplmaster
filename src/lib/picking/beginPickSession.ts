import { supabase } from '../supabase/client';
import { startPicking, startPickingErrorMessage, type StartPickingResult } from './startPicking';

export class BeginPickSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BeginPickSessionError';
    this.code = code;
  }
}

export interface BeginPickSessionOptions {
  orderId: number;
  userId: number;
  /** Claim from the unassigned pool before starting. */
  fromPool?: boolean;
}

export interface BeginPickSessionResult {
  claimId?: number;
  alreadyStarted?: boolean;
}

export async function beginPickSession(
  options: BeginPickSessionOptions,
): Promise<BeginPickSessionResult> {
  const { orderId, userId, fromPool = false } = options;
  let claimId: number | undefined;

  if (fromPool) {
    const { data, error: claimError } = await supabase.rpc('claim_order', {
      p_order_id: orderId,
      p_stage: 'picking',
      p_user_id: userId,
    });
    if (claimError) throw claimError;
    const claimResult = data as {
      success: boolean;
      reason?: string;
      claimed_by?: string;
      claim_id?: number;
    };
    if (!claimResult.success) {
      if (claimResult.reason === 'already_claimed') {
        throw new BeginPickSessionError(
          'already_claimed',
          claimResult.claimed_by ?? 'another picker',
        );
      }
      throw new BeginPickSessionError(
        claimResult.reason ?? 'claim_failed',
        claimResult.reason ?? 'Could not claim this order',
      );
    }
    claimId = claimResult.claim_id;
  }

  const startResult: StartPickingResult = await startPicking({ orderId, userId });
  if (!startResult.success) {
    throw new BeginPickSessionError(
      startResult.reason ?? 'start_failed',
      startPickingErrorMessage(startResult),
    );
  }

  return {
    claimId: startResult.claim_id ?? claimId,
    alreadyStarted: startResult.already_started,
  };
}

export function beginPickSessionErrorMessage(err: unknown): string {
  if (err instanceof BeginPickSessionError) {
    if (err.code === 'already_claimed') {
      return `Already being picked by ${err.message}.`;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Could not start picking';
}
