import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserCircle, Package } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { PageHeader, Card, Skeleton, BigButton, BottomSheet } from '../../components/shared';
import { useOrderDetail } from '../../hooks/useOrderDetail';
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
import { startPicking, startPickingErrorMessage } from '../../lib/picking/startPicking';

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

  const { data: order, isLoading, error } = useOrderDetail(orderId);
  const { myActive } = useClaimableOrders({
    stage: 'picking',
    workflowStatus: ['approved', 'picking'],
  });

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

  const openInProgressPick = useMemo(
    () => myActive.find((o) => isInProgressPick(o) && o.id !== orderId),
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

  const alreadyStarted = order != null && isPickStarted(order.workflow_status);

  const contextMessage = useMemo(() => {
    if (alreadyStarted && isAssignedToMe) {
      return 'Pick in progress — continue where you left off.';
    }
    if (isAssignedToMe || source === 'assigned') {
      return 'Assigned by billing — review the full pick list, then tap Start when ready.';
    }
    if (isPoolOrder || source === 'pool') {
      return 'Unassigned — you will claim this order when you tap Start.';
    }
    if (order?.picker_name && order.picker_name !== userName) {
      return `Assigned to ${order.picker_name}.`;
    }
    return 'Review the pick list before you start.';
  }, [alreadyStarted, isAssignedToMe, isPoolOrder, order?.picker_name, source, userName]);

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !userId) throw new Error('Not signed in');

      if (alreadyStarted) {
        return { navigated: true as const };
      }

      let claimId: number | undefined;

      if (isPoolOrder) {
        const { data, error: claimError } = await supabase.rpc('claim_order', {
          p_order_id: orderId,
          p_stage: 'picking',
          p_user_id: userId,
        });
        if (claimError) throw claimError;
        const claimResult = data as {
          success: boolean;
          reason?: string;
          claimed_by?: string;
          claim_id?: number;
        };
        if (!claimResult.success) {
          if (claimResult.reason === 'already_claimed') {
            throw new Error(`ALREADY_CLAIMED:${claimResult.claimed_by ?? 'someone'}`);
          }
          throw new Error(claimResult.reason ?? 'CLAIM_FAILED');
        }
        claimId = claimResult.claim_id;
      }

      const startResult = await startPicking({ orderId, userId });
      if (!startResult.success) {
        throw new Error(startPickingErrorMessage(startResult));
      }

      return { navigated: true as const, claimId: startResult.claim_id ?? claimId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['picker-daily-stats'] });
      navigate(`/picking/pick/${orderId}`, { replace: true });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('ALREADY_CLAIMED:')) {
        const who = msg.replace('ALREADY_CLAIMED:', '');
        toast.error(`Already being picked by ${who}.`);
      } else {
        toast.error(msg || 'Could not start picking.');
      }
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
    },
  });

  const handleStartClick = useCallback(() => {
    if (openInProgressPick) {
      toast.info('Finish your current pick before starting another order.');
      return;
    }
    if (isPoolOrder && !poolConfirmOpen) {
      setPoolConfirmOpen(true);
      return;
    }
    startMutation.mutate();
  }, [isPoolOrder, openInProgressPick, poolConfirmOpen, startMutation, toast]);

  const handleContinue = useCallback(() => {
    if (!orderId) return;
    navigate(`/picking/pick/${orderId}`);
  }, [navigate, orderId]);

  if (orderId === null || !Number.isFinite(orderId) || orderId <= 0) {
    return (
      <div className="min-h-screen p-4">
        <PageHeader title="Preview" onBack={() => navigate('/picking')} />
        <p className="text-sm text-[var(--content-secondary)] mt-4">Invalid order.</p>
      </div>
    );
  }

  const startBlocked = Boolean(openInProgressPick);
  const primaryLabel = alreadyStarted ? 'Continue picking' : 'Start picking';

  return (
    <div className="min-h-screen pb-32">
      <PageHeader
        title={order ? `Preview · ${order.order_number}` : 'Pick preview'}
        onBack={() => navigate('/picking')}
      />

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
              {isAssignedToMe && !alreadyStarted && (
                <span className="inline-flex rounded-full bg-[var(--bg-accent-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--content-accent)]">
                  Assigned to you
                </span>
              )}
            </div>
          </div>
        </Card>

        {openInProgressPick && (
          <Card className="border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]">
            <p className="text-sm font-semibold text-[var(--content-primary)]">
              You have an open pick
            </p>
            <p className="mt-1 text-sm text-[var(--content-secondary)]">
              {openInProgressPick.order_number} · {openInProgressPick.customer_name}
            </p>
            <button
              type="button"
              onClick={() => navigate(`/picking/pick/${openInProgressPick.id}`)}
              className="mt-3 text-sm font-semibold text-[var(--content-accent)]"
            >
              Resume current pick →
            </button>
          </Card>
        )}

        {isLoading && (
          <div className="space-y-3">
            <Skeleton variant="card" count={5} />
          </div>
        )}

        {error && (
          <p className="text-sm text-[var(--content-negative)]">
            Could not load this order. You may not have access, or it was removed.
          </p>
        )}

        {!isLoading && order && (
          <>
            <div className="sticky top-11 z-20 -mx-4 px-4 py-2 bg-[var(--bg-primary)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)]">
              <div className="flex flex-wrap items-center gap-2">
                {order.transport_name && (
                  <TransportChip name={order.transport_name} size="md" />
                )}
                <span className="text-xs tabular-nums text-[var(--content-tertiary)]">
                  {rows.length} lines · {totalPcs} pcs
                </span>
                {rackSummary && (
                  <span className="text-xs text-[var(--content-tertiary)]">{rackSummary}</span>
                )}
                {previewBrandCounts.ask > 0 && (
                  <BrandLineChip brand="ask" count={previewBrandCounts.ask} />
                )}
                {previewBrandCounts.lucas > 0 && (
                  <BrandLineChip brand="lucas" count={previewBrandCounts.lucas} />
                )}
              </div>
              <p className="mt-1 text-sm text-[var(--content-secondary)] truncate">
                {order.customer_name}
              </p>
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
                  const brand = orderItemBrandLabel(line);
                  const prevBrand = index > 0 ? orderItemBrandLabel(rows[index - 1]!) : null;
                  const brandLine = {
                    item_name: line.item_name,
                    main_group: line.catalog_main_group,
                    parent_group: line.catalog_parent_group,
                  };
                  const ask = isAskLine(brandLine);
                  const lucas = isLucasLine(brandLine);
                  return (
                    <li key={line.id}>
                      {brand !== prevBrand ? (
                        <p className="mb-1.5 mt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)] first:mt-0">
                          {brand}
                          {' · '}
                          {brandSections.find((s) => s.brand === brand)?.lines ?? 0} lines
                        </p>
                      ) : null}
                      <Card className="py-3 px-4 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-mono text-base font-bold text-[var(--content-primary)] leading-tight">
                            {line.rack_no || '—'}
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            {ask && <BrandLineChip brand="ask" />}
                            {lucas && <BrandLineChip brand="lucas" />}
                            <span className="text-sm font-semibold tabular-nums text-[var(--content-secondary)]">
                              {qty} pcs
                            </span>
                          </div>
                        </div>
                        <p className="text-sm font-medium text-[var(--content-primary)] leading-snug">
                          {line.item_name}
                        </p>
                        {(line.item_alias || line.catalog_alias1) && (
                          <p className="text-xs text-[var(--content-tertiary)] font-mono">
                            {line.item_alias ?? line.catalog_alias1}
                          </p>
                        )}
                      </Card>
                    </li>
                  );
                })
              )}
            </ul>
          </>
        )}
      </div>

      <div className="fixed bottom-20 inset-x-0 z-40 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          <BigButton
            onClick={alreadyStarted ? handleContinue : handleStartClick}
            disabled={startBlocked || startMutation.isPending || rows.length === 0}
            loading={startMutation.isPending}
          >
            {primaryLabel}
          </BigButton>
          <button
            type="button"
            onClick={() => navigate('/picking')}
            className="flex min-h-11 items-center justify-center gap-1.5 text-sm font-semibold text-[var(--content-secondary)]"
          >
            <ArrowLeft size={18} weight="bold" />
            Back to queue
          </button>
        </div>
      </div>

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
