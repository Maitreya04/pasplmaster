import {
  OPEN_PO_WORKFLOW_STATUSES,
  normalizeEmbeddedOrder,
  type OpenPoDemandLine,
} from '../../hooks/useOpenPoDemandLines';

export function filterOpenPoDemandLines(lines: OpenPoDemandLine[]): OpenPoDemandLine[] {
  return lines.filter((row) => {
    const order = normalizeEmbeddedOrder(row.orders);
    return order != null && OPEN_PO_WORKFLOW_STATUSES.has(order.workflow_status);
  });
}

/** item_id → live pending order lines (qty_po > 0, open workflow). */
export function groupOpenPoDemandByItemId(lines: OpenPoDemandLine[]): Map<number, OpenPoDemandLine[]> {
  const map = new Map<number, OpenPoDemandLine[]>();
  for (const line of filterOpenPoDemandLines(lines)) {
    const id = Number(line.item_id);
    if (!Number.isFinite(id)) continue;
    const list = map.get(id) ?? [];
    list.push(line);
    map.set(id, list);
  }
  return map;
}

export function sumQtyPo(lines: OpenPoDemandLine[]): number {
  let total = 0;
  for (const line of lines) {
    total += Number(line.qty_po) || 0;
  }
  return total;
}
