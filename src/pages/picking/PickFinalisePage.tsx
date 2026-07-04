import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CaretLeft, Flag, Warning, ArrowRight } from '@phosphor-icons/react';
import { BigButton, Skeleton } from '../../components/shared';
import { TransportChip } from '../../components/picking/TransportChip';
import { Numpad, numKey } from '../../components/picker-v10/Numpad';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import { useOfflinePickSession, useOfflinePicksHydrated } from '../../hooks/useOfflinePicks';
import { pickerBillingHandoffLine } from '../../lib/picking/pickerBillingHandoff';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatBilledLabel, formatLineCountLabel } from '../../lib/picking/pickQueueDisplay';
import { pickFinalisationCounts } from '../../lib/picking/pickFinalisationCounts';
import { completePickSession } from '../../lib/picking/completePickSession';
import { completeOfflinePick, isOfflinePickUsable } from '../../lib/offlinePicks';
import {
  buildPickCompletionSnapshot,
  withPickCompletionSaveState,
  type PickCompletionSnapshot,
} from '../../lib/picking/pickCompletionSnapshot';
import {
  isPickNoLongerActiveError,
  pickNoLongerActiveMessage,
} from '../../lib/picking/pickSessionErrors';
import { appHaptics } from '../../lib/haptics';
import { refreshWorkflowQueues, patchPickFinalisedInCache } from '../../lib/queueRefresh';
import { clearPickFlowSession } from '../../features/picking/lib/pickFlowSession';
import { PickCompleteScreen } from './PickCompleteScreen';

export default function PickFinalisePage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId, userName } = useAuth();
  const orderId = id ? parseInt(id, 10) : null;
  const isLab = searchParams.get('lab') === '1';

  const offlinePickSession = useOfflinePickSession(isLab ? null : orderId);
  const offlinePicksHydrated = useOfflinePicksHydrated();
  const offlinePickActive = !isLab && isOfflinePickUsable(offlinePickSession);
  const orderQuery = useOrderDetail(orderId);
  const order = offlinePickActive
    ? offlinePickSession?.orderSnapshot ?? orderQuery.data ?? null
    : orderQuery.data ?? null;
  const refetchOrder = orderQuery.refetch;
  const isLoading = orderQuery.isLoading && !offlinePickSession;
  const error = orderQuery.error && !offlinePickSession ? orderQuery.error : null;
  const workClaim = useWorkClaim(
    isLab || offlinePickActive || !offlinePicksHydrated ? null : orderId,
    'picking',
  );
  const claimId = offlinePickActive ? offlinePickSession?.claimId ?? null : isLab ? null : workClaim.claimId;
  const isClaimedByMe = offlinePickActive ? true : isLab ? true : workClaim.isClaimedByMe;
  const claim = isLab || offlinePickActive ? undefined : workClaim.claim;
  const claimError = isLab || offlinePickActive ? null : workClaim.error;
  const closedToastShownRef = useRef(false);

  const [boxCountInput, setBoxCountInput] = useState('');
  const [completionSnapshot, setCompletionSnapshot] =
    useState<PickCompletionSnapshot | null>(null);
  const pendingCompletionSnapshotRef = useRef<PickCompletionSnapshot | null>(null);

  const counts = useMemo(
    () => pickFinalisationCounts(order?.items ?? []),
    [order?.items],
  );

  const boxCount = useMemo(() => {
    const parsed = parseInt(boxCountInput, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [boxCountInput]);

  const expectAllDone =
    (location.state as { expectAllDone?: boolean } | null)?.expectAllDone === true;

  const canFinalise =
    boxCount >= 1 &&
    (isLab || isClaimedByMe) &&
    order?.workflow_status === 'picking' &&
    (isLab || offlinePickActive || counts.allDone);

  const waitingForFinalLineSync =
    expectAllDone &&
    !counts.allDone &&
    !isLab &&
    !offlinePickActive &&
    order?.workflow_status === 'picking';

  useEffect(() => {
    if (!orderId || !Number.isFinite(orderId)) {
      navigate('/picking', { replace: true });
    }
  }, [navigate, orderId]);

  useEffect(() => {
    if (completionSnapshot) return;
    if (!order || isLoading) return;
    if (!offlinePickActive && (order.workflow_status === 'completed' || order.workflow_status === 'flagged')) {
      if (!closedToastShownRef.current) {
        closedToastShownRef.current = true;
        toast.info('This pick is already finalised.');
      }
      navigate('/picking', { replace: true });
      return;
    }
    if (!offlinePickActive && order.workflow_status !== 'picking') {
      if (!closedToastShownRef.current) {
        closedToastShownRef.current = true;
        toast.info(pickNoLongerActiveMessage('not_picking'));
      }
      navigate('/picking', { replace: true });
      return;
    }
    if (!counts.allDone && !expectAllDone) {
      navigate(`/picking/pick/${orderId}`, { replace: true });
    }
  }, [
    completionSnapshot,
    counts.allDone,
    expectAllDone,
    isLoading,
    navigate,
    order,
    orderId,
    toast,
  ]);

  useEffect(() => {
    if (!waitingForFinalLineSync) return;
    void refetchOrder();
    const id = window.setInterval(() => {
      void refetchOrder();
    }, 1_000);
    return () => window.clearInterval(id);
  }, [refetchOrder, waitingForFinalLineSync]);

  useEffect(() => {
    if (isLab || offlinePickActive) return;
    if (order?.workflow_status === 'picking' && !isClaimedByMe && !claimError) {
      void claim?.();
    }
  }, [claim, claimError, isClaimedByMe, isLab, order?.workflow_status]);

  const handleNumpadKey = useCallback((key: string) => {
    appHaptics.selection();
    numKey(key, boxCountInput, setBoxCountInput);
  }, [boxCountInput]);

  const finaliseMutation = useMutation({
    mutationFn: async () => {
      if (!order || !orderId) throw new Error('No order');
      if (!isLab && !offlinePickActive && !isClaimedByMe) {
        throw new Error(pickNoLongerActiveMessage('claim_lost'));
      }
      const snapshot = buildPickCompletionSnapshot({
        order,
        counts,
        boxCount,
        billingNotified: false,
      });
      pendingCompletionSnapshotRef.current = snapshot;
      if (offlinePickActive) {
        const saved = await completeOfflinePick({ orderId, boxCount });
        if (!saved) {
          throw new Error('Could not save this pick on device');
        }
        if (saved.status === 'conflict' || saved.status === 'failed') {
          return withPickCompletionSaveState(snapshot, 'needs_review');
        }
        if (saved.status !== 'applied') {
          return withPickCompletionSaveState(snapshot, 'queued');
        }
        return snapshot;
      }
      const completion = await completePickSession({
        orderId,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        claimId: isLab ? null : claimId,
        userId: isLab ? null : userId,
        pickerName: userName,
        boxCount,
        hasFlagged: counts.hasFlagged,
        flaggedLineCount: counts.flagged,
        completedAt: order.completed_at,
        isLab,
      });
      return {
        ...snapshot,
        billingNotified: completion.billingNotified,
        billingNotificationError: completion.notificationError,
      };
    },
    onSuccess: (snapshot) => {
      if (orderId != null) {
        clearPickFlowSession(orderId, isLab ? 'lab' : 'production');
      }
      if (!isLab && !offlinePickActive && orderId != null) {
        patchPickFinalisedInCache(queryClient, orderId, {
          hasFlags: counts.hasFlagged,
        });
        void refreshWorkflowQueues(queryClient);
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        void queryClient.invalidateQueries({ queryKey: ['picker-daily-stats'] });
        void queryClient.invalidateQueries({ queryKey: ['picker-completed-orders'] });
      }
      if (snapshot.billingNotificationError) {
        toast.warning(`Pick saved, but billing notification failed: ${snapshot.billingNotificationError}`);
      }
      appHaptics.success();
      setCompletionSnapshot(snapshot);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Failed to finalise pick';
      const normalizedMessage = message.toLowerCase();
      const isReceiptCompatible =
        isPickNoLongerActiveError(message) ||
        normalizedMessage.includes('already finalised') ||
        normalizedMessage.includes('no longer active for picking') ||
        normalizedMessage.includes('picking lock');
      const snapshot = pendingCompletionSnapshotRef.current;
      if (isReceiptCompatible && snapshot) {
        setCompletionSnapshot(withPickCompletionSaveState(snapshot, 'already_saved'));
        void refreshWorkflowQueues(queryClient);
        void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
        void queryClient.invalidateQueries({ queryKey: ['picker-completed-orders'] });
        appHaptics.success();
        return;
      }
      toast.error(message);
    },
  });

  if (!orderId || !Number.isFinite(orderId)) {
    return null;
  }

  if (completionSnapshot) {
    return <PickCompleteScreen snapshot={completionSnapshot} orderId={orderId} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen p-4">
        <Skeleton variant="text" lines={2} />
        <div className="mt-4 space-y-3">
          <Skeleton variant="card" count={2} />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen p-4 text-center">
        <p className="text-[var(--content-negative)]">Failed to load order</p>
        <BigButton variant="secondary" onClick={() => navigate('/picking')} className="mt-4">
          Back to queue
        </BigButton>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--bg-primary)] pb-36">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => navigate(`/picking/pick/${orderId}`)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--content-secondary)] pick-pressable"
            aria-label="Back to pick"
          >
            <CaretLeft size={22} weight="bold" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-[var(--content-primary)]">
              {order.order_number}
            </p>
            <p className="text-[10px] font-medium text-[var(--content-tertiary)]">Pack & finish</p>
          </div>
        </div>
      </header>

      <div className="flex-1 p-4 space-y-4">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 space-y-2">
          <p className="text-xl font-bold text-[var(--content-primary)] leading-tight">
            {order.customer_name}
          </p>
          {order.customer_city && (
            <p className="text-sm text-[var(--content-secondary)]">{order.customer_city}</p>
          )}
          {formatBilledLabel(order.approved_at, order.created_at) && (
            <p className="text-sm text-[var(--content-tertiary)]">
              {formatBilledLabel(order.approved_at, order.created_at)}
            </p>
          )}
          <div className="pt-1">
            {order.transport_name ? (
              <TransportChip name={order.transport_name} size="md" />
            ) : (
              <p className="text-sm font-semibold text-[var(--content-warning)]">
                No transport on order
              </p>
            )}
          </div>
          <p className="font-mono text-xs text-[var(--content-quaternary)] pt-1">
            {order.order_number}
          </p>
        </div>

        <div className="rounded-xl bg-[var(--bg-tertiary)] px-4 py-3 text-sm text-[var(--content-secondary)] space-y-1">
          <p className="tabular-nums">
            {formatLineCountLabel(counts.picked, { short: true })} picked
            {counts.flagged > 0 && (
              <span className="text-[var(--content-negative)]">
                {' '}
                · {counts.flagged} flagged
              </span>
            )}
          </p>
          <p className="tabular-nums text-[var(--content-tertiary)]">
            {counts.piecePicked}/{counts.pieceTarget} pcs picked
          </p>
          {counts.flagged > 0 && (
            <p className="flex items-center gap-1.5 text-[var(--content-warning)] pt-1">
              <Flag size={14} weight="fill" />
              Billing will resolve flagged lines
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <p className="text-sm font-semibold text-[var(--content-primary)] mb-3">
            How many boxes for this pick?
          </p>
          <Numpad
            display={boxCountInput}
            onKey={handleNumpadKey}
            onConfirm={() => {}}
            confirmLabel=""
            hideConfirm
            tone={counts.hasFlagged ? 'amber' : 'default'}
          />
          {!isLab && order.workflow_status === 'picking' && !isClaimedByMe && (
            <p className="mt-3 text-center text-xs font-semibold text-[var(--content-warning)]">
              Securing pick lock before finalise...
            </p>
          )}
          {waitingForFinalLineSync && (
            <p className="mt-3 text-center text-xs font-semibold text-[var(--content-warning)]">
              Syncing final picked line...
            </p>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 space-y-2">
        <BigButton
          variant="primary"
          disabled={!canFinalise}
          loading={finaliseMutation.isPending}
          onClick={() => {
            appHaptics.impactMedium();
            finaliseMutation.mutate();
          }}
          className={
            counts.hasFlagged
              ? 'bg-[var(--bg-warning)] text-[var(--content-primary)] disabled:opacity-40'
              : 'bg-[var(--bg-positive)] text-[var(--content-on-color)] disabled:opacity-40'
          }
        >
          {counts.hasFlagged ? (
            <>
              <Warning size={20} weight="bold" />
              Finalise pick — {counts.flagged} flagged item{counts.flagged === 1 ? '' : 's'}
            </>
          ) : (
            <>
              <ArrowRight size={20} weight="bold" />
              Finalise pick!
            </>
          )}
        </BigButton>
        <p className="text-center text-[11px] text-[var(--content-tertiary)] px-2">
          {pickerBillingHandoffLine(counts.hasFlagged)}
        </p>
      </div>
    </div>
  );
}
