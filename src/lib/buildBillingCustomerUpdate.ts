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

  const shareLines: OrderCustomerShareLine[] = lines.map((line) => ({
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
    lines: lines.map((line) => ({
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
