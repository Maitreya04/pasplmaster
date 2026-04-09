import type { OrderItem } from '../types';
import type { FlagIssue, ResolveDecision, ManualFlag } from '../hooks/useBillingFlowMachine';

export function buildSalesCommunicateDraft(params: {
  orderNumber: string;
  orderName: string;
  salesperson: string | null;
  items: OrderItem[];
  issues: FlagIssue[];
  decisions: Record<number, ResolveDecision>;
  manualFlags: Record<number, ManualFlag>;
}): string {
  const { orderNumber, orderName, salesperson, items, issues, decisions, manualFlags } = params;
  const lines: string[] = [];
  lines.push(`Hi ${salesperson || 'Team'} — order ${orderNumber} for ${orderName} has updates:`);

  issues.forEach((issue) => {
    const item = items[issue.itemIndex];
    if (!item) return;
    const decision = decisions[item.id];
    const manualFlag = manualFlags[issue.itemIndex];
    const available = manualFlag?.availableQty ?? item.qty_shippable ?? 0;

    if (decision === 'bill_available_po_rest') {
      lines.push(
        `• ${item.item_alias || ''} ${item.item_name}: Only ${available} available. Billed ${available}, remaining ${item.qty_requested - available} sent to PO.`,
      );
    } else if (decision === 'bill_available') {
      lines.push(
        `• ${item.item_alias || ''} ${item.item_name}: Only ${available} available. Billed ${available}, rest dropped.`,
      );
    } else if (decision === 'drop_entirely') {
      lines.push(`• ${item.item_alias || ''} ${item.item_name}: Removed from order entirely.`);
    }
  });

  lines.push('Rest of the order is approved and going to picking.');
  return lines.join('\n\n');
}
