import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CaretLeft } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { pickQuantityTarget } from '../../lib/cartSupply';
import { defaultPickItemTransitionAdapter } from '../../lib/picking/itemTransitionAdapter';
import {
  binIdForPickItem,
  consumeBinLayerForPick,
} from '../../lib/wms/binLayers';
import { orderItemPickCode } from '../../utils/itemCodes';
import { PickerV10Flow } from '../../components/picker-v10';
import type { PickerV10Line, PickerV10PickResult } from '../../components/picker-v10';
import { PickCompleteScreen } from './PickCompleteScreen';
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
      ? `MRP confirmed with mismatch flag (label ₹${result.confirmedMrp}, system ₹${result.latestMrp})`
      : 'Picker v2 — MRP confirmed at pick',
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
  claimId,
  userId,
  userName,
  onBack,
}: PickPageV2PanelProps): React.JSX.Element {
  const { error, warning } = useToast();
  const queryClient = useQueryClient();
  const [showComplete, setShowComplete] = useState(false);

  const activeItems = useMemo(() => pendingLines(orderItems), [orderItems]);
  const lines = useMemo(() => activeItems.map(toPickerLine), [activeItems]);

  const totalLines = orderItems.length;
  const pickedLines = orderItems.filter((oi) => oi.state === 'picked').length;
  const flaggedLines = orderItems.filter((oi) => oi.state === 'flagged').length;
  const totalPieces = orderItems.reduce((s, oi) => s + pickQuantityTarget(oi), 0);
  const pickedPieces = orderItems
    .filter((oi) => oi.state === 'picked')
    .reduce((s, oi) => s + pickQuantityTarget(oi), 0);

  const completeMutation = useMutation({
    mutationFn: async () => {
      const flagged = orderItems.some((oi) => oi.state === 'flagged');
      if (claimId && userId) {
        const { error } = await supabase.rpc('complete_picking', {
          p_order_id: order.id,
          p_claim_id: claimId,
          p_user_id: userId,
          p_has_flags: flagged,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from('orders')
        .update({
          workflow_status: flagged ? 'flagged' : 'completed',
          ...(flagged ? {} : { completed_at: new Date().toISOString(), priority: 'normal' }),
        })
        .eq('id', order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      appHaptics.success();
      setShowComplete(true);
    },
    onError: () => error('Failed to complete order'),
  });

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
      appHaptics.success();
    },
    [order.id, orderItems, queryClient, warning, userId, userName],
  );

  const handleAllComplete = useCallback(() => {
    void completeMutation.mutate();
  }, [completeMutation]);

  if (showComplete) {
    return (
      <PickCompleteScreen
        orderNumber={order.order_number}
        customerName={order.customer_name}
        customerCity={order.customer_city}
        transportName={order.transport_name}
        pickedLineCount={pickedLines}
        flaggedLineCount={flaggedLines}
        totalLineCount={totalLines}
        pickedPieceCount={pickedPieces}
        totalPieceCount={totalPieces}
      />
    );
  }

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
            disabled={completeMutation.isPending}
            className="mt-4 rounded-xl bg-[var(--bg-inverse-primary)] px-6 py-3 text-sm font-bold text-white pick-pressable disabled:opacity-50"
          >
            {completeMutation.isPending ? 'Submitting…' : 'Complete order'}
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
