import {
  buildOrderCustomerMessage,
  type OrderCustomerShareLine,
} from './buildOrderCustomerMessage';

export type BillingCustomerUpdateLineInput = {
  itemId: number | null;
  name: string;
  qtyRequested: number;
  qtyBilled: number;
  qtyPending: number;
};

export type BillingCustomerUpdateLineSummary = {
  item_id: number | null;
  item_name: string;
  qty_requested: number;
  qty_billed: number;
  qty_pending: number;
  classification: 'billed' | 'partial' | 'pending';
};

export type BillingCustomerUpdateSummary = {
  order_number: string;
  customer_name: string;
  message_type: 'billed_pending_blocks';
  lines: BillingCustomerUpdateLineSummary[];
};

function normalizeLine(line: BillingCustomerUpdateLineInput): BillingCustomerUpdateLineInput {
  const qtyRequested = Math.max(0, line.qtyRequested);
  const qtyPending = Math.min(qtyRequested, Math.max(0, line.qtyPending));
  const qtyBilled = Math.min(
    Math.max(0, line.qtyBilled),
    Math.max(0, qtyRequested - qtyPending),
  );
  return {
    ...line,
    qtyRequested,
    qtyBilled,
    qtyPending,
  };
}

function classifyLine(line: BillingCustomerUpdateLineInput): BillingCustomerUpdateLineSummary['classification'] {
  if (line.qtyBilled > 0 && line.qtyPending > 0) return 'partial';
  if (line.qtyBilled > 0) return 'billed';
  return 'pending';
}

export function buildBillingCustomerUpdate(params: {
  orderNumber: string;
  customerName: string;
  businessName?: string;
  date: Date;
  lines: BillingCustomerUpdateLineInput[];
}) {
  const { orderNumber, customerName, businessName, date, lines } = params;
  const normalizedLines = lines.map(normalizeLine);

  const shareLines: OrderCustomerShareLine[] = normalizedLines.map((line) => ({
    name: line.name,
    qtyRequested: line.qtyRequested,
    qtyShip: Math.max(0, line.qtyBilled),
    qtyPo: Math.max(0, line.qtyPending),
  }));

  const messageText = buildOrderCustomerMessage({
    customerName,
    businessName,
    date,
    lines: shareLines,
  });

  const summary: BillingCustomerUpdateSummary = {
    order_number: orderNumber,
    customer_name: customerName,
    message_type: 'billed_pending_blocks',
    lines: normalizedLines.map((line) => ({
      item_id: line.itemId,
      item_name: line.name,
      qty_requested: line.qtyRequested,
      qty_billed: Math.max(0, line.qtyBilled),
      qty_pending: Math.max(0, line.qtyPending),
      classification: classifyLine(line),
    })),
  };

  return {
    messageText,
    summary,
  };
}
