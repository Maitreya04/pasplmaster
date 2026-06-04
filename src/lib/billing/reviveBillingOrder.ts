import { supabase } from '../supabase/client';
import type { Order } from '../../types';

export interface ReviveBillingOrderInput {
  orderId: number;
  actorUserId: number;
  actorName: string;
}

export interface ReviveBillingOrderResult {
  warnings: unknown[];
}

const REVIVE_ERROR_MESSAGES: Record<string, string> = {
  order_not_found: 'Order not found',
  not_rejected: 'Order is not on hold or rejected',
  not_account_hold: 'Only account holds can be returned to billing',
  reservations_already_active: 'Stock reservations are still active — try again',
  revive_failed: 'Could not return order to billing',
};

function messageFromUnknown(err: unknown): string | null {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return null;
}

export function formatReviveBillingOrderError(err: unknown): string {
  return messageFromUnknown(err) ?? 'Failed to revive order';
}

export async function reviveBillingOrder(
  input: ReviveBillingOrderInput,
): Promise<ReviveBillingOrderResult> {
  const { data, error: rpcError } = await supabase.rpc('revive_billing_order', {
    p_order_id: input.orderId,
    p_actor_user_id: input.actorUserId,
    p_actor_name: input.actorName,
  });

  if (rpcError) {
    throw new Error(formatReviveBillingOrderError(rpcError));
  }

  const payload = data as {
    success?: boolean;
    error?: string;
    lines?: Array<{ item_name?: string }>;
    warnings?: unknown[];
  };

  if (!payload?.success) {
    if (payload.error === 'insufficient_stock' && Array.isArray(payload.lines)) {
      const names = payload.lines
        .map((line) => line.item_name)
        .filter(Boolean)
        .join(', ');
      throw new Error(
        names
          ? `Insufficient stock for: ${names}`
          : 'Insufficient stock to revive this order',
      );
    }
    const code = payload.error ?? 'revive_failed';
    throw new Error(REVIVE_ERROR_MESSAGES[code] ?? code);
  }

  return {
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
  };
}

export function reviveSuccessToast(
  order: Pick<Order, 'order_number'>,
  warnings: unknown[],
): string {
  const warningCount = warnings.length;
  if (warningCount > 0) {
    return `Order revived with ${warningCount} line qty adjustment${warningCount === 1 ? '' : 's'}`;
  }
  return `Order ${order.order_number} returned to billing queue`;
}
