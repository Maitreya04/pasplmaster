import type { Order, RejectionKind } from '../../types';

export const ACCOUNT_HOLD_NOTE =
  'Account locked — billing on hold until account is unlocked';

export function isAccountHold(order: Pick<Order, 'workflow_status' | 'rejection_kind'>): boolean {
  return (
    order.workflow_status === 'rejected' && order.rejection_kind === 'account_hold'
  );
}

export function isRevivableHold(order: Pick<Order, 'workflow_status' | 'rejection_kind'>): boolean {
  return isAccountHold(order);
}

export function canRevive(order: Pick<Order, 'workflow_status' | 'rejection_kind'>): boolean {
  return isRevivableHold(order);
}

export function isTerminalReject(order: Pick<Order, 'workflow_status' | 'rejection_kind'>): boolean {
  if (order.workflow_status !== 'rejected') return false;
  return order.rejection_kind === 'terminal' || order.rejection_kind == null;
}

export function accountHoldDisplayNote(notes: string | null | undefined): string {
  const raw = notes?.trim();
  if (raw) return raw;
  return ACCOUNT_HOLD_NOTE;
}

export function rejectKindLabel(kind: RejectionKind | null | undefined): string {
  if (kind === 'account_hold') return 'On hold';
  return 'Rejected';
}
