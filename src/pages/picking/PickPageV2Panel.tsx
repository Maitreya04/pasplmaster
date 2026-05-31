import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CaretLeft } from '@phosphor-icons/react';
import { pickQuantityTarget } from '../../lib/cartSupply';
import { STOCK_MRP_HISTORY_QUERY_KEY } from '../../lib/stockMrpwise';
import { defaultPickItemTransitionAdapter } from '../../lib/picking/itemTransitionAdapter';
import {
  binIdForPickItem,
  consumeBinLayerForPick,
} from '../../lib/wms/binLayers';
import { orderItemPickCode } from '../../utils/itemCodes';
import { PickerV10Flow } from '../../components/picker-v10';
import type { PickerV10Line, PickerV10PickResult } from '../../components/picker-v10';
import type { OrderItem, OrderWithItems, ScanResult, StockLocationCode } from '../../types';
import { useToast } from '../../context/ToastContext';
import { appHaptics } from '../../lib/haptics';

export interface PickPageV2PanelProps {
  order: OrderWithItems;
  orderItems: OrderItem[];
  claimId: number | null;
  userId: number | null;
  userName: string | null;
  onBack: () => void;
}

function pendingLines(items: OrderItem[]): OrderItem[] {
  return items.filter((oi) => oi.state === 'pending');
}

function toPickerLine(oi: OrderItem): PickerV10Line {
  const code = orderItemPickCode(oi) || String(oi.item_id);
  return {
    id: oi.id,
    orderItemId: oi.id,
    code,
    name: oi.item_name,
    rack: oi.rack_no,
    qty: pickQuantityTarget(oi),
    verifyMode: 'confirm',
    busyCode: oi.catalog_busy_code ?? null,
    stockLocationCode: (oi.stock_location_code as StockLocationCode | null) ?? null,
  };
}

function buildPickScanResult(
  result: PickerV10PickResult,
  orderItem: OrderItem,
  userName: string | null,
  userId: number | null,
): ScanResult {
  const targetQty = pickQuantityTarget(orderItem);
  const pickedQty = result.outOfStock ? 0 : Math.min(targetQty, result.qty);
  return {
    scannedText: result.line.code,
    confidence: 100,
    isMatch: true,
    matchedAgainst: result.line.code,
    matchStrategy: 'picker_v2_mrp_confirm',
    ocrExtracted: {
      partNumber: result.line.code,
      mrp: result.confirmedMrp,
    },
    method: 'manual',
    timestamp: new Date().toISOString(),
    reason: result.mrpFlagged
      ? `Label MRP ₹${result.confirmedMrp} differs from suggested ₹${result.latestMrp}`
      : 'Label MRP confirmed at pick',
    progress: {
      pickedQty,
      remainingQty: Math.max(0, targetQty - pickedQty),
      targetQty,
    },
    confirmedMrp: result.confirmedMrp,
    mrpFlagged: result.mrpFlagged,
    mrpSource: result.mrpSource,
    mrpHistoryCount: result.historyCount,
    operatorContext: {
      pickerName: userName,
      pickerUserId: userId,
      source: 'manual',
    },
  };
}

export function PickPageV2Panel({
  order,
  orderItems,
  userId,
  userName,
  onBack,
}: PickPageV2PanelProps): React.JSX.Element {
  const navigate = useNavigate();
  const { warning } = useToast();
  const queryClient = useQueryClient();

  const activeItems = useMemo(() => pendingLines(orderItems), [orderItems]);
  const lines = useMemo(() => activeItems.map(toPickerLine), [activeItems]);
  const allDone = lines.length === 0 && orderItems.length > 0;
  const prevAllDoneRef = useRef(false);

  useEffect(() => {
    if (allDone && !prevAllDoneRef.current) {
      navigate(`/picking/pick/${order.id}/finish`, { state: { expectAllDone: true } });
    }
    prevAllDoneRef.current = allDone;
  }, [allDone, navigate, order.id]);

  const handlePickLine = useCallback(
    async (result: PickerV10PickResult): Promise<void> => {
      const itemId = result.line.orderItemId;
      if (!itemId) return;
      const orderItem = orderItems.find((oi) => oi.id === itemId);
      if (!orderItem) return;

      const scanResult = buildPickScanResult(result, orderItem, userName, userId);

      if (result.outOfStock) {
        await defaultPickItemTransitionAdapter.applyTransition({
          kind: 'flagged',
          itemId,
          reason: 'Out of Stock',
          notes: 'Picker v2 — out of stock at pick',
          boxPrice: null,
          scanResult,
        });
        void queryClient.invalidateQueries({ queryKey: ['order', order.id] });
        void queryClient.invalidateQueries({ queryKey: [STOCK_MRP_HISTORY_QUERY_KEY] });
        return;
      }

      const qty = pickQuantityTarget(orderItem);
      if (qty > 0) {
        const inv = await consumeBinLayerForPick({
          orderItemId: itemId,
          qtyEa: qty,
          userId,
          binId: binIdForPickItem(orderItem),
        });
        if (!inv.success && inv.reason !== 'insufficient_layer_stock') {
          if (inv.reason === 'override_reason_required') {
            warning('FIFO override needed — pick recorded without layer consume.');
          } else if (inv.reason !== 'qty_invalid') {
            warning(`Shelf: ${inv.reason}`);
          }
        }
      }

      await defaultPickItemTransitionAdapter.applyTransition({
        kind: 'picked',
        itemId,
        scanResult,
      });
      void queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      void queryClient.invalidateQueries({ queryKey: [STOCK_MRP_HISTORY_QUERY_KEY] });
      appHaptics.success();
    },
    [order.id, orderItems, queryClient, warning, userId, userName],
  );

  const handleAllComplete = useCallback(() => {
    navigate(`/picking/pick/${order.id}/finish`);
  }, [navigate, order.id]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg pick-pressable"
          aria-label="Back to queue"
        >
          <CaretLeft size={22} weight="bold" />
        </button>
        <p className="truncate text-sm font-semibold text-[var(--content-primary)]">
          {order.customer_name}
        </p>
        <span className="ml-auto rounded-md bg-[var(--bg-accent-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--content-accent)]">
          v2
        </span>
      </div>

      {lines.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-[var(--content-secondary)]">All lines handled.</p>
          <button
            type="button"
            onClick={handleAllComplete}
            className="mt-4 rounded-xl bg-[var(--bg-positive)] px-6 py-3 text-sm font-bold text-[var(--content-on-color)] pick-pressable"
          >
            Pack & finish
          </button>
        </div>
      ) : (
        <PickerV10Flow
          lines={lines}
          orderLabel={order.order_number}
          customerLabel={order.customer_name}
          liveWrite
          onPickLineComplete={handlePickLine}
          onAllComplete={handleAllComplete}
        />
      )}
    </div>
  );
}
