import { sortBillLines } from './sortBillLines';
import { orderLineLabel } from '../../utils/formatters';
import type { FulfillmentPath, OrderItem } from '../../types';
import type { ItemFlag } from '../../hooks/useBillingFlow';

function fulfillmentFooterMessage(
  path: FulfillmentPath,
  pickLineCount: number,
  pendingLineCount: number,
): string {
  if (path === 'direct_bill' && pickLineCount <= 0) {
    return pendingLineCount > 0
      ? 'Order direct-billed — pending items recorded, no warehouse pick.'
      : 'Order direct-billed — no warehouse pick.';
  }
  if (pendingLineCount > 0 && pickLineCount > 0) {
    return `Approved — ${pickLineCount} line${pickLineCount === 1 ? '' : 's'} sent to warehouse pick; ${pendingLineCount} pending.`;
  }
  return 'Order approved and sent to warehouse pick.';
}

export function buildBillingHandoffReportText(params: {
  orderNumber: string;
  orderName: string;
  salesperson: string | null;
  items: OrderItem[];
  flags: Record<number, ItemFlag>;
  resolvedFulfillmentPath: FulfillmentPath;
  effectivePickLineCount: number;
}): string {
  const {
    orderNumber,
    orderName,
    salesperson,
    items,
    flags,
    resolvedFulfillmentPath,
    effectivePickLineCount,
  } = params;
  const lines: string[] = [];
  const sortedItems = sortBillLines(items);

  const num = orderNumber.trim();
  const orderHead =
    num.length > 0 ? `order ${num} (${orderName})` : `order for ${orderName}`;
  lines.push(`Hi ${salesperson || 'Team'} — billing update for ${orderHead}:`);

  const partialItems: string[] = [];
  const noStockItems: string[] = [];
  let billedCount = 0;

  sortedItems.forEach((item) => {
    const flag = flags[item.id];
    if (!flag) {
      billedCount++;
      return;
    }
    const label = orderLineLabel(item);
    if (flag.type === 'partial' && flag.availableQty != null) {
      const pending = item.qty_requested - flag.availableQty;
      partialItems.push(
        `• ${label}: Ordered ${item.qty_requested}, billed ${flag.availableQty}, ${pending} pending`,
      );
    } else {
      noStockItems.push(
        `• ${label}: Ordered ${item.qty_requested}, fully pending (no stock)`,
      );
    }
  });

  if (partialItems.length > 0) {
    lines.push(`Partial stock:\n${partialItems.join('\n')}`);
  }
  if (noStockItems.length > 0) {
    lines.push(`Out of stock:\n${noStockItems.join('\n')}`);
  }
  if (billedCount > 0) {
    lines.push(`${billedCount} item${billedCount !== 1 ? 's' : ''} billed as ordered.`);
  }

  const pendingLineCount = sortedItems.filter((item) => flags[item.id]).length;
  lines.push(
    fulfillmentFooterMessage(
      resolvedFulfillmentPath,
      effectivePickLineCount,
      pendingLineCount,
    ),
  );
  return lines.join('\n\n');
}
