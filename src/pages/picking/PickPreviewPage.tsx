import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CaretLeft, UserCircle, Package, Play } from '@phosphor-icons/react';
import { Card, Skeleton, BigButton, BottomSheet } from '../../components/shared';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useOrderHandoff } from '../../hooks/useOrderHandoff';
import { handoffFirstName } from '../../lib/billing/orderHandoffFromEvents';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { pickQuantityTarget, pickableOrderItems } from '../../lib/cartSupply';
import { isAskLine } from '../../lib/picking/askBrand';
import { isLucasLine } from '../../lib/picking/lucasBrand';
import { BrandLineChip } from '../../components/picking/BrandLineChip';
import { TransportChip } from '../../components/picking/TransportChip';
import { sortPickWalkOrder } from '../../lib/picking/pickWalkOrder';
import { buildPickWalkBrandSections, orderItemBrandLabel } from '../../lib/picking/deckOrder';
import { rackRangeFromPreview } from '../../lib/picking/pickQueueDisplay';
import { isInProgressPick, isPickStarted } from '../../lib/picking/pickLifecycle';
import {
  beginOfflinePickSession,
  beginOfflinePickSessionErrorMessage,
} from '../../lib/picking/beginOfflinePickSession';
import { readOfflinePickSession } from '../../lib/offlinePicks';
import type { OrderItem } from '../../types';

function getLineMrp(line: OrderItem): number | null {
  if (line.price_system != null && line.price_system > 0) return line.price_system;
  if (line.price_quoted != null && line.price_quoted > 0) return line.price_quoted;
  return null;
}

/**
 * Trip brief shown once before starting a new pick. In-progress orders skip this
 * and go straight to the pick deck.
 */
export default function PickPreviewPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId, userName } = useAuth();
  const { id } = useParams<{ id: string }>();
  const orderId = id ? parseInt(id, 10) : null;
  const source = searchParams.get('source');
  const [poolConfirmOpen, setPoolConfirmOpen] = useState(false);
  const skippedPreviewRef = useRef(false);

  const { data: order, isLoading, error } = useOrderDetail(orderId);
  const { data: handoffSummary } = useOrderHandoff(orderId, Boolean(orderId), {
    picker_name: order?.picker_name,
    reviewer_name: order?.reviewer_name,
    fulfillment_path: order?.fulfillment_path,
  });
  const { myActive } = useClaimableOrders({
    stage: 'picking',
    workflowStatus: ['approved', 'picking'],
  });

  const alreadyStarted = order != null && isPickStarted(order.workflow_status);

  // Resume path — never show the trip brief twice for the same order.
  useEffect(() => {
    if (!orderId || !Number.isFinite(orderId) || orderId <= 0) return;
    if (isLoading || skippedPreviewRef.current) return;
    if (order && alreadyStarted) {
      skippedPreviewRef.current = true;
      navigate(`/picking/pick/${orderId}`, { replace: true });
    }
  }, [alreadyStarted, isLoading, navigate, order, orderId]);

  const rows = useMemo(() => {
    if (!order?.items?.length) return [];
    return sortPickWalkOrder(pickableOrderItems(order.items));
  }, [order?.items]);

  const brandSections = useMemo(
    () => buildPickWalkBrandSections(rows, pickQuantityTarget),
    [rows],
  );

  const totalPcs = useMemo(
    () => rows.reduce((sum, line) => sum + pickQuantityTarget(line), 0),
    [rows],
  );

  const rackSummary = useMemo(
    () =>
      rackRangeFromPreview(
        rows.map((line) => ({ rack_no: line.rack_no, item_name: line.item_name, state: 'pending' })),
      ),
    [rows],
  );

  const previewBrandCounts = useMemo(() => {
    let ask = 0;
    let lucas = 0;
    for (const line of rows) {
      const brandLine = {
        item_name: line.item_name,
        main_group: line.catalog_main_group,
        parent_group: line.catalog_parent_group,
      };
      if (isAskLine(brandLine)) ask += 1;
      if (isLucasLine(brandLine)) lucas += 1;
    }
    return { ask, lucas };
  }, [rows]);

  const otherInProgressPicks = useMemo(
    () => myActive.filter((o) => isInProgressPick(o) && o.id !== orderId),
    [myActive, orderId],
  );

  const isAssignedToMe = useMemo(() => {
    if (!order || !userName) return false;
    const mine = myActive.some((o) => o.id === orderId && o.is_mine);
    if (mine) return true;
    return order.picker_name === userName && order.workflow_status === 'approved';
  }, [myActive, order, orderId, userName]);

  const isPoolOrder = useMemo(() => {
    if (!order) return false;
    return order.workflow_status === 'approved' && !order.picker_name && !isAssignedToMe;
  }, [isAssignedToMe, order]);

  const contextMessage = useMemo(() => {
    if (isAssignedToMe || source === 'assigned') {
      const assigner = handoffSummary?.assignedBy
        ? handoffFirstName(handoffSummary.assignedBy)
        : null;
      const assignerPhrase = assigner ? `Assigned by ${assigner}` : 'Assigned by billing';
      return `${assignerPhrase} — review the full pick list, then tap Start when ready.`;
    }
    if (isPoolOrder || source === 'pool') {
      return 'Unassigned — you will claim this order when you tap Start.';
    }
    if (order?.picker_name && order.picker_name !== userName) {
      return `Assigned to ${order.picker_name}.`;
    }
    return 'Review the pick list before you start.';
  }, [handoffSummary?.assignedBy, isAssignedToMe, isPoolOrder, order?.picker_name, source, userName]);

  const knownClaimId = useMemo(() => {
    const mine = myActive.find((o) => o.id === orderId);
    return mine?.claim_info?.claim_id ?? null;
  }, [myActive, orderId]);

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !userId || !order) throw new Error('Not signed in');

      const existing = await readOfflinePickSession(orderId);
      if (existing && (existing.status === 'preparing' || existing.status === 'active')) {
        return beginOfflinePickSession({
          orderId,
          userId,
          pickerName: userName,
          fromPool: isPoolOrder,
          knownClaimId,
          orderSnapshot: existing.orderSnapshot,
        });
      }

      return beginOfflinePickSession({
        orderId,
        userId,
        pickerName: userName,
        fromPool: isPoolOrder,
        knownClaimId,
        orderSnapshot: order,
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['picker-daily-stats'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      if (result.bootstrapPending) {
        toast.info('Pick saved on this device. Connecting to server in the background.');
      } else if (result.resumed) {
        toast.success('Resuming your offline pick');
      } else {
        toast.success('Pick ready — scans save on this device');
      }
      navigate(`/picking/pick/${orderId}`, { replace: true });
    },
    onError: (err) => {
      toast.error(beginOfflinePickSessionErrorMessage(err));
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
    },
  });

  const handleStartClick = useCallback(() => {
    if (isPoolOrder && !poolConfirmOpen) {
      setPoolConfirmOpen(true);
      return;
    }
    startMutation.mutate();
  }, [isPoolOrder, poolConfirmOpen, startMutation]);

  if (orderId === null || !Number.isFinite(orderId) || orderId <= 0) {
    return (
      <div className="min-h-screen p-4">
        <button
          type="button"
          onClick={() => navigate('/picking')}
          className="flex items-center gap-1 text-sm text-[var(--content-secondary)]"
        >
          <CaretLeft size={18} weight="bold" />
          Back
        </button>
        <p className="text-sm text-[var(--content-secondary)] mt-4">Invalid order.</p>
      </div>
    );
  }

  if (isLoading || alreadyStarted) {
    return (
      <div className="min-h-screen p-4">
        <div className="flex items-center gap-2 mb-6">
          <CaretLeft size={22} weight="bold" className="text-[var(--content-tertiary)]" />
          <span className="text-sm font-semibold text-[var(--content-primary)]">
            {order ? order.order_number : 'Loading…'}
          </span>
        </div>
        <div className="space-y-3">
          <Skeleton variant="card" count={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => navigate('/picking')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--content-secondary)] pick-pressable"
            aria-label="Back to queue"
          >
            <CaretLeft size={22} weight="bold" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-[var(--content-primary)]">
              {order ? order.order_number : 'Pick preview'}
            </p>
            <p className="text-[10px] font-medium text-[var(--content-tertiary)]">
              Preview pick list
            </p>
          </div>
        </div>
      </header>

      <div className="p-4 space-y-4">
        <Card className="border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <div className="flex items-start gap-3">
            <UserCircle
              size={22}
              weight="duotone"
              className="text-[var(--content-accent)] shrink-0 mt-0.5"
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm text-[var(--content-secondary)]">{contextMessage}</p>
              {isAssignedToMe && (
                <span className="inline-flex rounded-full bg-[var(--bg-accent-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--content-accent)]">
                  Assigned to you
                </span>
              )}
            </div>
          </div>
        </Card>

        {otherInProgressPicks.length > 0 && (
          <Card className="border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]">
            <p className="text-sm font-semibold text-[var(--content-primary)]">
              {otherInProgressPicks.length === 1
                ? 'You have another pick in progress'
                : `${otherInProgressPicks.length} other picks in progress`}
            </p>
            <ul className="mt-2 space-y-2">
              {otherInProgressPicks.map((pick) => (
                <li key={pick.id}>
                  <p className="text-sm text-[var(--content-secondary)]">
                    {pick.order_number} · {pick.customer_name}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate(`/picking/pick/${pick.id}`)}
                    className="mt-1 text-sm font-semibold text-[var(--content-accent)]"
                  >
                    Resume →
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {error && (
          <p className="text-sm text-[var(--content-negative)]">
            Could not load this order. You may not have access, or it was removed.
          </p>
        )}

        {order && (
          <>
            <div className="sticky top-[52px] z-20 -mx-4 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]">
              <div className="flex items-center gap-3 px-4 py-2.5">
                {/* Summary metrics — left */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--content-primary)]">
                    {order.customer_name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {order.transport_name && (
                      <TransportChip name={order.transport_name} size="sm" />
                    )}
                    {rackSummary && (
                      <span className="text-[10px] font-medium text-[var(--content-tertiary)]">
                        {rackSummary}
                      </span>
                    )}
                  </div>
                </div>
                {/* Line + Pcs count — prominent right */}
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xl font-extrabold tabular-nums leading-tight text-[var(--content-primary)]">
                    {rows.length}
                    <span className="ml-1 text-xs font-semibold text-[var(--content-tertiary)]">lines</span>
                  </p>
                  <p className="text-[10px] font-semibold tabular-nums text-[var(--content-secondary)]">
                    {totalPcs} pcs
                  </p>
                </div>
              </div>
              {(previewBrandCounts.ask > 0 || previewBrandCounts.lucas > 0) && (
                <div className="flex gap-1.5 border-t border-[var(--border-faint)] px-4 py-1.5">
                  {previewBrandCounts.ask > 0 && (
                    <BrandLineChip brand="ask" count={previewBrandCounts.ask} />
                  )}
                  {previewBrandCounts.lucas > 0 && (
                    <BrandLineChip brand="lucas" count={previewBrandCounts.lucas} />
                  )}
                </div>
              )}
            </div>

            <ul className="space-y-2">
              {rows.length === 0 ? (
                <Card className="py-4 px-4">
                  <p className="font-semibold text-[var(--content-primary)]">Nothing to pick</p>
                  <p className="text-sm text-[var(--content-secondary)] mt-1">
                    Billing approved this order with no shippable stock — all lines are on purchase
                    order.
                  </p>
                </Card>
              ) : (
                rows.map((line, index) => {
                  const qty = pickQuantityTarget(line);
                  const mrp = getLineMrp(line);
                  const brand = orderItemBrandLabel(line);
                  const prevBrand = index > 0 ? orderItemBrandLabel(rows[index - 1]!) : null;
                  const brandLine = {
                    item_name: line.item_name,
                    main_group: line.catalog_main_group,
                    parent_group: line.catalog_parent_group,
                  };
                  const ask = isAskLine(brandLine);
                  const lucas = isLucasLine(brandLine);
                  const partCode = line.catalog_alias1 ?? line.catalog_alias ?? line.item_alias;
                  return (
                    <li key={line.id}>
                      {brand !== prevBrand ? (
                        <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)] first:mt-0">
                          {brand}
                          {' · '}
                          {brandSections.find((s) => s.brand === brand)?.lines ?? 0} lines
                        </p>
                      ) : null}
                      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] overflow-hidden">
                        <div className="flex min-h-[72px]">
                          {/* Rack hero — large, left */}
                          <div className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-[var(--border-faint)] bg-[var(--bg-tertiary)] px-2">
                            <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                              Rack
                            </span>
                            <span className="mt-0.5 font-mono text-lg font-extrabold leading-tight text-[var(--content-primary)]">
                              {line.rack_no || '—'}
                            </span>
                          </div>

                          {/* Main content */}
                          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2.5">
                            {/* Part code (loud) + brand chips */}
                            <div className="flex items-center gap-2">
                              <p className="min-w-0 truncate font-mono text-sm font-bold text-[var(--content-primary)]">
                                {partCode ?? '—'}
                              </p>
                              {ask && <BrandLineChip brand="ask" />}
                              {lucas && <BrandLineChip brand="lucas" />}
                            </div>
                            {/* Item name (quieter) */}
                            <p className="line-clamp-2 text-xs leading-snug text-[var(--content-secondary)]">
                              {line.item_name}
                            </p>
                          </div>

                          {/* Qty + MRP — bold metrics, right aligned */}
                          <div className="flex shrink-0 flex-col items-end justify-center gap-0.5 border-l border-[var(--border-faint)] bg-[var(--bg-primary)] px-3 py-2">
                            <span className="font-mono text-xl font-extrabold tabular-nums text-[var(--content-primary)]">
                              {qty}
                            </span>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
                              pcs
                            </span>
                            {mrp != null && (
                              <span className="mt-1 font-mono text-xs font-semibold tabular-nums text-[var(--content-accent)]">
                                ₹{Math.round(mrp)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </>
        )}
      </div>

      {/* Floating start button — compact, doesn't block content */}
      <button
        type="button"
        onClick={handleStartClick}
        disabled={startMutation.isPending || rows.length === 0}
        className="fixed bottom-6 right-4 z-40 flex h-14 items-center gap-2 rounded-full bg-[var(--bg-inverse-primary)] pl-5 pr-6 text-[var(--content-on-color)] shadow-xl ring-1 ring-black/5 pick-pressable disabled:opacity-50 sm:bottom-8 sm:right-6"
      >
        {startMutation.isPending ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <Play size={20} weight="fill" />
        )}
        <span className="text-base font-bold">
          {startMutation.isPending ? 'Starting…' : 'Start picking'}
        </span>
      </button>

      <BottomSheet
        isOpen={poolConfirmOpen}
        onClose={() => setPoolConfirmOpen(false)}
        title="Claim this order?"
      >
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <Package size={24} weight="duotone" className="shrink-0 text-[var(--content-accent)]" />
            <p className="text-sm text-[var(--content-secondary)]">
              This order is not assigned to you. Claim and start only if billing has not assigned
              another picker yet.
            </p>
          </div>
          <BigButton
            onClick={() => {
              setPoolConfirmOpen(false);
              startMutation.mutate();
            }}
            loading={startMutation.isPending}
          >
            Claim and start
          </BigButton>
        </div>
      </BottomSheet>
    </div>
  );
}
