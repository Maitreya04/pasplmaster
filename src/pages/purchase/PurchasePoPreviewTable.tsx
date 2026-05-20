import type { ItemLocationStock } from '../../hooks/useLocationwiseStock';
import { isLocationwiseStockResolving } from '../../hooks/useLocationwiseStock';
import type { OpenPoDemandLine } from '../../hooks/useOpenPoDemandLines';
import { normalizeEmbeddedOrder } from '../../hooks/useOpenPoDemandLines';
import type { PurchasePoPreviewRow } from '../../lib/import/purchasePoImporter';
import { sumQtyPo } from '../../lib/purchase/openPoDemand';
import { formatStockQty } from '../../lib/stockDisplay';

const th =
  'sticky top-0 z-10 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)] last:border-r-0';
const td =
  'border-b border-r border-[var(--border-subtle)] px-2 py-1.5 align-top text-sm last:border-r-0';
const tdNum = `${td} font-mono tabular-nums text-right`;
const inputCell =
  'w-full min-w-[4.5rem] rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-right font-mono text-sm font-semibold tabular-nums text-[var(--content-primary)] focus:border-[var(--bg-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--bg-accent)] disabled:cursor-not-allowed disabled:opacity-50';

function stockCell(
  qty: number | null | undefined,
  loading: boolean,
): string {
  if (loading) return '…';
  if (qty == null || !Number.isFinite(Number(qty))) return '—';
  return formatStockQty(Number(qty));
}

function formatPendingOrdersSummary(lines: OpenPoDemandLine[]): string {
  if (lines.length === 0) return '—';
  return lines
    .map((line) => {
      const order = normalizeEmbeddedOrder(line.orders);
      const q = formatStockQty(Number(line.qty_po) || 0);
      const ref = order?.order_number ?? '?';
      return `${ref} (${q})`;
    })
    .join(', ');
}

export function PurchasePoPreviewTable({
  rows,
  demandByItemId,
  stockByBusyCode,
  stockFetching,
  onOrderQtyChange,
}: {
  rows: PurchasePoPreviewRow[];
  demandByItemId: Map<number, OpenPoDemandLine[]>;
  stockByBusyCode: Record<number, ItemLocationStock> | undefined;
  stockFetching: boolean;
  onOrderQtyChange: (rowIndex: number, qty: number) => void;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-left">
          <thead>
            <tr>
              <th className={th}>Row</th>
              <th className={th}>Part no</th>
              <th className={th}>Busy</th>
              <th className={`${th} min-w-[12rem]`}>Description</th>
              <th className={`${th} text-right`}>Main store</th>
              <th className={`${th} text-right`}>Jabalpur</th>
              <th className={`${th} text-right`}>Excel</th>
              <th className={`${th} text-right`}>Pending PO</th>
              <th className={`${th} min-w-[10rem]`}>Pending orders</th>
              <th className={`${th} text-right min-w-[6rem]`}>Order qty</th>
              <th className={`${th} min-w-[8rem]`}>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const demandLines =
                r.resolvedItemId != null ? demandByItemId.get(r.resolvedItemId) ?? [] : [];
              const pendingQty = sumQtyPo(demandLines);
              const stock =
                r.resolvedBusyCode != null ? stockByBusyCode?.[r.resolvedBusyCode] : undefined;
              const stockLoading =
                r.resolvedBusyCode != null &&
                isLocationwiseStockResolving(r.resolvedBusyCode, stockFetching);
              const unmatched = r.resolvedBusyCode == null;

              return (
                <tr
                  key={r.rowIndex}
                  className={
                    unmatched
                      ? 'bg-[color-mix(in_srgb,var(--bg-warning-subtle)_40%,transparent)]'
                      : 'hover:bg-[var(--bg-primary)]'
                  }
                >
                  <td className={`${td} font-mono text-xs text-[var(--content-tertiary)]`}>{r.rowIndex}</td>
                  <td className={`${td} font-mono text-xs font-semibold`}>{r.partRaw}</td>
                  <td className={`${td} font-mono text-xs`}>{r.resolvedBusyCode ?? '—'}</td>
                  <td className={td}>{r.resolvedItemName ?? r.descriptionRaw}</td>
                  <td className={tdNum}>{stockCell(stock?.mainStoreStockQty, stockLoading)}</td>
                  <td className={tdNum}>{stockCell(stock?.jabalpurStockQty, stockLoading)}</td>
                  <td className={tdNum}>{r.qtyOrdered > 0 ? formatStockQty(r.qtyOrdered) : '—'}</td>
                  <td className={tdNum}>
                    {pendingQty > 0 ? (
                      <button
                        type="button"
                        title="Set order qty to pending total"
                        className="font-semibold text-[var(--content-warning)] hover:underline"
                        onClick={() => onOrderQtyChange(r.rowIndex, pendingQty)}
                      >
                        {formatStockQty(pendingQty)}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${td} max-w-[14rem] text-xs text-[var(--content-secondary)]`}>
                    <span className="line-clamp-2" title={formatPendingOrdersSummary(demandLines)}>
                      {formatPendingOrdersSummary(demandLines)}
                    </span>
                  </td>
                  <td className={tdNum}>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      disabled={unmatched}
                      value={r.orderQty}
                      onChange={(e) => {
                        const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                        onOrderQtyChange(r.rowIndex, n);
                      }}
                      className={inputCell}
                      aria-label={`Order qty for ${r.partRaw}`}
                    />
                  </td>
                  <td className={`${td} text-xs text-[var(--content-warning)]`}>{r.warning ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--content-tertiary)]">
        Click a <strong className="text-[var(--content-warning)]">Pending PO</strong> value to copy it into Order qty.
        Edit <strong>Order qty</strong> cells directly (like Excel).
      </p>
    </div>
  );
}
