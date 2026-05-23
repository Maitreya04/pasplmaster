import { pickableOrderItems, pickQuantityTarget } from '../cartSupply';
import { formatTimestamp, orderItemProductCode, orderLineLabel } from '../../utils/formatters';
import type { OrderItem } from '../../types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PRINT_STYLES = `
  @page { margin: 12mm; }
  body { font-family: system-ui, sans-serif; color: #111; margin: 0; padding: 0; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { font-size: 12px; color: #475569; margin-bottom: 16px; }
  .picker-box {
    margin: 12px 0 16px;
    padding: 10px 14px;
    border: 2px solid #ca8a04;
    border-radius: 8px;
    background: #fef9c3;
    font-size: 14px;
  }
  .picker-box strong { font-size: 16px; color: #854d0e; }
  .picker-box.waiting { border-color: #94a3b8; background: #f1f5f9; }
  .picker-box.waiting strong { color: #475569; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
  th { background: #f8fafc; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .foot { margin-top: 12px; font-size: 11px; color: #64748b; }
`;

export type PickingChalanOrder = {
  order_number: string;
  customer_name: string;
  customer_city: string | null;
  salesperson_name: string;
  transport_name: string | null;
  reviewer_name: string | null;
  picker_name: string | null;
  picked_at: string | null;
  workflow_status: string;
  approved_at: string | null;
  notes: string | null;
};

/** Opens a printable picking chalan with picker attribution for billing. */
export function openPickingChalanPrint(
  order: PickingChalanOrder,
  items: OrderItem[],
): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;

  const pickLines = pickableOrderItems(items);
  const rows = pickLines
    .map((item, idx) => {
      const qty = pickQuantityTarget(item);
      const code = orderItemProductCode(item) || '—';
      return `<tr>
        <td class="num">${idx + 1}</td>
        <td>${escapeHtml(code)}</td>
        <td>${escapeHtml(orderLineLabel(item))}</td>
        <td class="num">${qty}</td>
      </tr>`;
    })
    .join('');

  const pickerHtml = order.picker_name
    ? `<div class="picker-box">
        <div>Picking accepted by</div>
        <strong>${escapeHtml(order.picker_name)}</strong>
        ${order.picked_at ? `<div style="margin-top:4px;font-size:12px;">Since ${escapeHtml(formatTimestamp(order.picked_at))}</div>` : ''}
      </div>`
    : `<div class="picker-box waiting">
        <div>Picking</div>
        <strong>Waiting for picker — not yet claimed</strong>
      </div>`;

  const location = [order.customer_city, order.transport_name].filter(Boolean).join(' · ');
  const notes = order.notes?.trim();

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Picking chalan — ${escapeHtml(order.order_number)}</title>
    <style>${PRINT_STYLES}</style>
  </head><body>
    <h1>Picking chalan · ${escapeHtml(order.order_number)}</h1>
    <div class="meta">
      ${escapeHtml(order.customer_name)}
      ${location ? ` · ${escapeHtml(location)}` : ''}
      <br>Sales: ${escapeHtml(order.salesperson_name)}
      ${order.reviewer_name ? ` · Approved by ${escapeHtml(order.reviewer_name)}` : ''}
      ${order.approved_at ? ` · ${escapeHtml(formatTimestamp(order.approved_at))}` : ''}
    </div>
    ${pickerHtml}
    <table>
      <thead><tr><th>#</th><th>Code</th><th>Item</th><th>Qty to pick</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No pickable lines</td></tr>'}</tbody>
    </table>
    <p class="foot">${pickLines.length} line${pickLines.length === 1 ? '' : 's'} · printed ${escapeHtml(formatTimestamp(new Date().toISOString()))}</p>
    ${notes ? `<p class="foot"><strong>Note:</strong> ${escapeHtml(notes)}</p>` : ''}
    <script>window.onload=function(){window.print();}</script>
  </body></html>`);
  w.document.close();
  return true;
}
