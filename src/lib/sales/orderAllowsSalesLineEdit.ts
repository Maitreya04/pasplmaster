import type { Order, OrderWithItems } from '../../types';

type SalesEditableOrder = Pick<
  Order | OrderWithItems,
  'workflow_status' | 'picker_name' | 'salesperson_user_id'
>;

/** True when the owning salesperson may add/remove lines (before picker assignment). */
export function orderAllowsSalesLineEdit(
  order: SalesEditableOrder | null | undefined,
  userId: number | null | undefined,
): boolean {
  if (!order || userId == null) return false;
  if (order.salesperson_user_id == null || order.salesperson_user_id !== userId) {
    return false;
  }
  if (order.picker_name != null && order.picker_name.trim() !== '') {
    return false;
  }
  return order.workflow_status === 'submitted' || order.workflow_status === 'approved';
}

/** Human-readable hint for why edit is unavailable. */
export function salesLineEditHint(order: SalesEditableOrder | null | undefined): string | null {
  if (!order) return null;
  if (order.picker_name != null && order.picker_name.trim() !== '') {
    return `Assigned to ${order.picker_name.trim()} — editing is closed.`;
  }
  if (order.workflow_status === 'picking') {
    return 'Picking has started — editing is closed.';
  }
  if (order.workflow_status !== 'submitted' && order.workflow_status !== 'approved') {
    return 'This order can no longer be edited.';
  }
  return null;
}
