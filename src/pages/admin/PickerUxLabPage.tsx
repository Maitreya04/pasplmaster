import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CaretLeft, Flask, Package } from '@phosphor-icons/react';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useStockMrpHistory } from '../../hooks/useStockMrpHistory';
import { pickQuantityTarget, pickableOrderItems } from '../../lib/cartSupply';
import { PickCard } from '../../components/picking/PickCard';
import { PickQtySheet } from '../../components/picking/PickQtySheet';
import { MrpHistorySheet } from '../../components/picker-v10/MrpHistorySheet';
import { PickSwipeDeck } from '../../components/picker-v10/PickSwipeDeck';
import type { PickSwipeDotStatus } from '../../components/picker-v10/PickSwipeDeck';
import { DEMO_PICKER_LINES } from '../../components/picker-v10/demoItems';
import type { PickLineMrpState } from '../../lib/picking/pickLineMrp';
import type { PickLineOutcomeKind } from '../../components/picking/PickLineResolvedDock';
import {
  pickOutcomeDetail,
  pickOutcomeHeadline,
  resolvePickOutcomeKind,
} from '../../lib/picking/pickLineOutcome';
import { orderItemBrandLabel, wrapIndex } from '../../lib/picking/deckOrder';
import { appHaptics } from '../../lib/haptics';
import type { OrderItem, StockLocationCode } from '../../types';
import { Skeleton } from '../../components/shared';

interface LabLineState {
  rackVerified: boolean;
  lineMrp: PickLineMrpState;
  pickedQty: number;
  uiState: 'pending' | 'picked' | 'flagged';
  lineOutcome: {
    kind: PickLineOutcomeKind;
    reason?: string;
    pickedQty?: number;
  } | null;
}

function defaultLabLineState(): LabLineState {
  return {
    rackVerified: false,
    lineMrp: { confirmedMrp: null, customMrp: null },
    pickedQty: 0,
    uiState: 'pending',
    lineOutcome: null,
  };
}

function demoLineToOrderItem(line: (typeof DEMO_PICKER_LINES)[0], orderId: number): OrderItem {
  return {
    id: line.id,
    order_id: orderId,
    item_id: line.id,
    item_name: line.name,
    item_alias: line.code,
    catalog_alias1: line.code,
    catalog_alias: null,
    catalog_busy_code: line.busyCode ?? null,
    rack_no: line.rack,
    qty_requested: line.qty,
    qty_shippable: line.qty,
    qty_approved: line.qty,
    stock_location_code: line.stockLocationCode ?? null,
    price_quoted: null,
    price_system: null,
    state: 'pending',
    flag_reason: null,
    flag_notes: null,
    flag_box_price: null,
    scan_result: null,
  };
}

export default function PickerUxLabPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isDemo = searchParams.get('demo') === '1';
  const orderIdParam = searchParams.get('orderId');
  const orderId = orderIdParam ? Number(orderIdParam) : null;

  const [orderInput, setOrderInput] = useState(orderIdParam ?? '');
  const [lineStates, setLineStates] = useState<Record<number, LabLineState>>({});
  const [cardIndex, setCardIndex] = useState(0);
  const [mrpSheetOpen, setMrpSheetOpen] = useState(false);
  const [qtySheetOpen, setQtySheetOpen] = useState(false);

  const { data: order, isLoading: orderLoading } = useOrderDetail(
    !isDemo && orderId != null && Number.isFinite(orderId) ? orderId : null,
  );

  const liveItems = useMemo(
    () => (order?.items ? pickableOrderItems(order.items) : []),
    [order?.items],
  );

  const demoItems = useMemo(
    () => DEMO_PICKER_LINES.map((l) => demoLineToOrderItem(l, -1)),
    [],
  );

  const items = isDemo ? demoItems : liveItems;
  const safeIndex = items.length > 0 ? wrapIndex(cardIndex, items.length) : 0;
  const activeItem = items[safeIndex];
  const activeState = activeItem ? (lineStates[activeItem.id] ?? defaultLabLineState()) : defaultLabLineState();
  const demoLine = isDemo ? DEMO_PICKER_LINES[safeIndex] : null;

  const busyCode = activeItem?.catalog_busy_code ?? demoLine?.busyCode ?? null;
  const stockLoc = (activeItem?.stock_location_code as StockLocationCode | null) ?? null;

  const { data: mrpData, isLoading: mrpLoading } = useStockMrpHistory(
    busyCode,
    stockLoc,
    null,
    !isDemo && busyCode != null && activeState.rackVerified,
  );

  const mrpHistoryForActive = isDemo
    ? (demoLine?.mrpHistory ?? [])
    : (mrpData?.history ?? []);

  const targetQty = activeItem
    ? isDemo
      ? (demoLine?.qty ?? 0)
      : pickQuantityTarget(activeItem)
    : 0;

  const patchLine = useCallback((itemId: number, patch: Partial<LabLineState>) => {
    setLineStates((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? defaultLabLineState()), ...patch },
    }));
  }, []);

  const resetAllLines = useCallback((): void => {
    setLineStates({});
    setCardIndex(0);
    setMrpSheetOpen(false);
    setQtySheetOpen(false);
  }, []);

  const advanceFromOutcome = useCallback((): void => {
    if (items.length <= 1) return;
    setCardIndex((idx) => wrapIndex(idx + 1, items.length));
    appHaptics.selection();
  }, [items.length]);

  const closeLineWithQty = useCallback(
    (itemId: number, qty: number, lineTarget: number) => {
      const kind = resolvePickOutcomeKind(qty, lineTarget);
      patchLine(itemId, {
        pickedQty: qty,
        uiState: 'picked',
        lineOutcome: { kind, pickedQty: qty },
      });
      appHaptics.success();
    },
    [patchLine],
  );

  const mountedIndices = useMemo(() => {
    const len = items.length;
    if (len === 0) return new Set<number>();
    if (len <= 3) return new Set(Array.from({ length: len }, (_, i) => i));
    return new Set([
      safeIndex,
      wrapIndex(safeIndex - 1, len),
      wrapIndex(safeIndex + 1, len),
    ]);
  }, [items.length, safeIndex]);

  const dotStatus = useMemo((): PickSwipeDotStatus[] => {
    return items.map((item, index) => {
      const st = lineStates[item.id] ?? defaultLabLineState();
      if (index === safeIndex) return 'active';
      if (st.lineOutcome?.kind === 'flagged' || st.uiState === 'flagged') return 'flagged';
      if (st.lineOutcome?.kind === 'partial') return 'partial';
      if (st.lineOutcome?.kind === 'picked' || st.uiState === 'picked') return 'done';
      return 'pending';
    });
  }, [items, lineStates, safeIndex]);

  const loadOrder = (): void => {
    const trimmed = orderInput.trim();
    if (!trimmed) return;
    setSearchParams({ orderId: trimmed });
    resetAllLines();
  };

  const startDemo = (): void => {
    setSearchParams({ demo: '1' });
    resetAllLines();
  };

  if (!isDemo && !orderId) {
    return (
      <div className="role-picking min-h-screen bg-[var(--bg-primary)]">
        <LabHeader onBack={() => navigate('/admin')} subtitle="Choose a mode" />
        <div className="mx-auto max-w-lg space-y-4 p-4">
          <ModeCard
            icon={<Flask size={20} className="text-[var(--content-accent)]" />}
            title="Demo mode"
            description="Swipe deck with 4 demo lines — tap dots or fling left/right."
            actionLabel="Start demo"
            onAction={startDemo}
          />
          <ModeCard
            icon={<Package size={20} className="text-[var(--content-positive)]" />}
            title="Live order preview"
            description="Same swipe deck as production with stock_mrpwise MRP."
            actionLabel="Load"
            onAction={loadOrder}
            showInput
            inputValue={orderInput}
            onInputChange={setOrderInput}
          />
        </div>
      </div>
    );
  }

  if (!isDemo && orderLoading) {
    return (
      <div className="role-picking min-h-screen p-4">
        <Skeleton className="mx-auto h-[480px] w-full max-w-lg rounded-3xl" />
      </div>
    );
  }

  if (!activeItem || items.length === 0) {
    return (
      <div className="role-picking min-h-screen p-8 text-center text-sm text-[var(--content-tertiary)]">
        No pick lines to preview.
      </div>
    );
  }

  return (
    <div className="role-picking min-h-screen bg-[var(--bg-primary)]">
      <LabHeader
        onBack={() => navigate('/admin')}
        subtitle={
          isDemo
            ? `Demo · line ${safeIndex + 1}/${items.length}`
            : (order?.order_number ?? `Order #${orderId}`)
        }
      />

      <div className="mx-auto max-w-lg px-2 pb-6 pt-2">
        <PickSwipeDeck
          currentIndex={safeIndex}
          itemCount={items.length}
          onIndexChange={setCardIndex}
          dotStatus={dotStatus}
        >
          {items.map((item, index) => {
            const st = lineStates[item.id] ?? defaultLabLineState();
            const lineDemo = isDemo ? DEMO_PICKER_LINES[index] : null;
            const lineTarget = isDemo
              ? (lineDemo?.qty ?? 0)
              : pickQuantityTarget(item);
            const isCurrent = index === safeIndex;
            const displayPicked = st.lineOutcome?.pickedQty ?? st.pickedQty;
            const lineMrpHistory = isDemo
              ? (lineDemo?.mrpHistory ?? [])
              : isCurrent
                ? mrpHistoryForActive
                : [];

            const outcomeHeadline = st.lineOutcome
              ? pickOutcomeHeadline(
                  st.lineOutcome.kind,
                  st.lineOutcome.pickedQty ?? displayPicked,
                  lineTarget,
                  st.lineOutcome.reason,
                )
              : undefined;
            const outcomeDetail = st.lineOutcome
              ? pickOutcomeDetail(
                  st.lineOutcome.kind,
                  lineTarget,
                  st.lineOutcome.pickedQty ?? displayPicked,
                )
              : undefined;

            return (
              <div key={item.id} className="h-full w-full">
                {mountedIndices.has(index) ? (
                  <PickCard
                    orderItem={item}
                    uiState={st.uiState}
                    scanResult={null}
                    phase={st.rackVerified ? 'verified' : 'awaiting_rack'}
                    isCurrent={isCurrent}
                    rackVerified={st.rackVerified}
                    pickedQty={displayPicked}
                    targetQty={lineTarget}
                    positionLabel={`${orderItemBrandLabel(item)} · ${index + 1} of ${items.length}`}
                    mrpHistory={isCurrent && st.rackVerified ? lineMrpHistory : []}
                    mrpHistoryLoading={isCurrent && st.rackVerified && !isDemo && mrpLoading}
                    lineMrp={st.lineMrp}
                    lineOutcome={isCurrent ? (st.lineOutcome?.kind ?? null) : null}
                    outcomeHeadline={isCurrent ? outcomeHeadline : undefined}
                    outcomeDetail={isCurrent ? outcomeDetail : undefined}
                    onAdvanceNext={
                      isCurrent && st.lineOutcome ? advanceFromOutcome : undefined
                    }
                    onRackTap={() => patchLine(item.id, { rackVerified: true })}
                    onManualQty={() => {
                      setCardIndex(index);
                      setQtySheetOpen(true);
                    }}
                    onEditMrp={() => {
                      setCardIndex(index);
                      setMrpSheetOpen(true);
                    }}
                    onConfirmMrp={() => {
                      setCardIndex(index);
                      const history = isCurrent ? lineMrpHistory : (lineDemo?.mrpHistory ?? []);
                      if (history.length === 1) {
                        patchLine(item.id, {
                          lineMrp: { confirmedMrp: history[0]!.mrp, customMrp: null },
                        });
                        appHaptics.success();
                        return;
                      }
                      setMrpSheetOpen(true);
                    }}
                    onFlag={() => {
                      patchLine(item.id, {
                        uiState: 'flagged',
                        lineOutcome: { kind: 'flagged', reason: 'Wrong MRP' },
                      });
                      appHaptics.warning();
                    }}
                    onEngageScanner={() => {
                      setCardIndex(index);
                      if (!st.rackVerified) {
                        patchLine(item.id, { rackVerified: true });
                      } else {
                        closeLineWithQty(item.id, lineTarget, lineTarget);
                      }
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </PickSwipeDeck>
      </div>

      <PickQtySheet
        isOpen={qtySheetOpen}
        initialQty={Math.max(1, targetQty - (activeState.lineOutcome?.pickedQty ?? activeState.pickedQty))}
        targetQty={targetQty}
        pickedQty={activeState.lineOutcome?.pickedQty ?? activeState.pickedQty}
        partCode={
          activeItem.catalog_alias1 ??
          activeItem.catalog_alias ??
          activeItem.item_alias ??
          null
        }
        rackNo={activeItem.rack_no}
        onConfirm={(qty) => {
          setQtySheetOpen(false);
          closeLineWithQty(activeItem.id, qty, targetQty);
        }}
        onOutOfStock={() => {
          setQtySheetOpen(false);
          patchLine(activeItem.id, {
            uiState: 'flagged',
            lineOutcome: { kind: 'flagged', reason: 'Out of Stock' },
          });
          appHaptics.warning();
        }}
        onClose={() => setQtySheetOpen(false)}
      />

      <MrpHistorySheet
        isOpen={mrpSheetOpen}
        history={mrpHistoryForActive}
        confirmedMrp={activeState.lineMrp.confirmedMrp}
        customMrp={activeState.lineMrp.customMrp}
        partCode={
          activeItem.catalog_alias1 ??
          activeItem.catalog_alias ??
          activeItem.item_alias ??
          null
        }
        rackNo={activeItem.rack_no}
        onSelectMrp={(mrp) => {
          patchLine(activeItem.id, { lineMrp: { confirmedMrp: mrp, customMrp: null } });
          setMrpSheetOpen(false);
        }}
        onSelectCustomMrp={(mrp) => {
          patchLine(activeItem.id, { lineMrp: { customMrp: mrp, confirmedMrp: null } });
          setMrpSheetOpen(false);
        }}
        onClose={() => setMrpSheetOpen(false)}
      />
    </div>
  );
}

function LabHeader({
  onBack,
  subtitle,
}: {
  onBack: () => void;
  subtitle: string;
}): React.JSX.Element {
  return (
    <div className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl pick-pressable"
          aria-label="Back"
        >
          <CaretLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">Picker UX Lab</p>
          <p className="truncate text-xs text-[var(--content-tertiary)]">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  showInput,
  inputValue,
  onInputChange,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  showInput?: boolean;
  inputValue?: string;
  onInputChange?: (v: string) => void;
}): React.JSX.Element {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <p className="font-semibold">{title}</p>
      </div>
      <p className="mb-4 text-sm text-[var(--content-tertiary)]">{description}</p>
      {showInput ? (
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={inputValue}
            onChange={(e) => onInputChange?.(e.target.value)}
            placeholder="Order ID"
            className="min-h-11 flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 font-mono text-sm"
          />
          <button
            type="button"
            onClick={onAction}
            className="rounded-xl bg-[var(--bg-inverse-primary)] px-4 text-sm font-bold text-white pick-pressable"
          >
            {actionLabel}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAction}
          className="w-full rounded-xl bg-[var(--bg-inverse-primary)] py-3.5 text-sm font-bold text-white pick-pressable"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
