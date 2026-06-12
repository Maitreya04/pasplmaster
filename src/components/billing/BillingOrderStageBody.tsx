import { useCallback, useMemo, useState } from 'react';
import { buildBusyPasteText } from '../../lib/billing/sortBillLines';
import { deriveReviewWorkMetrics } from '../../lib/billing/deriveReviewWorkMetrics';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import type { RejectionKind } from '../../types';
import { BillingRejectDialog } from './BillingRejectDialog';
import { useRejectBillingOrder } from '../../hooks/useRejectBillingOrder';
import { computePickLineProgress } from '../../lib/cartSupply';
import { deriveBillingOperatorStage } from '../../lib/billing/deriveBillingOperatorStage';
import { derivePickingMonitorPresentation } from '../../lib/billing/pickingMonitorPresentation';
import {
  formatDeskFlagSummarySubtitle,
  summarizeDeskFlags,
} from '../../lib/billing/deskLineFlagKind';
import { useBusyPasteModel } from '../../lib/billing/useBusyPasteModel';
import { AssignPickerStage } from './stages/AssignPickerStage';
import { PostPickReviewStage } from './stages/PostPickReviewStage';
import { PickingBillStage } from './stages/PickingBillStage';
import { CompleteHandoffStage } from './stages/CompleteHandoffStage';
import { BillingOrderChrome } from './chrome/BillingOrderChrome';
import { BillingBillHeader } from './chrome/BillingBillHeader';
import { BillingBusyDock } from './busyEntry/BillingBusyDock';
import { BillingWorkDock } from './busyEntry/BillingWorkDock';
import { BusyPasteLineList } from './busyEntry/BusyPasteLineList';
import { usePickerLoad } from '../../hooks/usePickerLoad';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';
import type { DeskOrderRow } from '../../hooks/useBillingDeskOrders';
import type { OrderWithItems } from '../../types';
import type { BillingLineEdit, ItemFlag } from '../../hooks/useBillingFlow';
import { formatCurrencyRaw } from '../../utils/formatters';
import { useOrderHandoff } from '../../hooks/useOrderHandoff';

interface BillingOrderStageBodyProps {
  order: DeskOrderRow;
  orderDetail: OrderWithItems;
  billSheet: BillSheetEdits;
  flaggedMode: boolean;
  embedded?: boolean;
  /** Desk left pane: show bill header and inline assign while embedded. */
  deskEmbedded?: boolean;
  onClose?: () => void;
  /** Submitted-order busy paste (live queue / review pre-approve). */
  busyPaste?: {
    lineEdits: Record<number, BillingLineEdit>;
    flags: Record<number, ItemFlag>;
    onFinish: () => void;
    finishLoading?: boolean;
  };
}


export function BillingOrderStageBody({
  order,
  orderDetail,
  billSheet,
  flaggedMode: _flaggedMode,
  embedded = false,
  deskEmbedded = false,
  onClose,
  busyPaste,
}: BillingOrderStageBodyProps): React.JSX.Element {
  const { pickers, colors: pickerColors } = usePickerLoad();
  const { copy, copiedId } = useCopyToClipboard();
  const [showAssign, setShowAssign] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectKind, setRejectKind] = useState<RejectionKind>('account_hold');
  const [rejectReason, setRejectReason] = useState('');

  const canReject = orderDetail.workflow_status === 'submitted';
  const rejectMutation = useRejectBillingOrder(
    canReject ? orderDetail : null,
    () => onClose?.(),
  );

  const handleRejectConfirm = useCallback(() => {
    if (rejectMutation.isPending) return;
    const trimmedReason = rejectReason.trim();
    if (!trimmedReason) return;
    rejectMutation.mutate({ kind: rejectKind, reason: trimmedReason });
  }, [rejectKind, rejectReason, rejectMutation]);

  const stage = useMemo(
    () =>
      deriveBillingOperatorStage({
        workflow_status: orderDetail.workflow_status,
        picker_name: orderDetail.picker_name,
        reviewer_name: orderDetail.reviewer_name,
        fulfillment_path: orderDetail.fulfillment_path ?? order.fulfillment_path,
        stock_location_code:
          orderDetail.stock_location_code ?? order.stock_location_code,
        deskStatus: order.deskStatus,
        openPickerFlagCount: order.pickerFlags.length,
      }),
    [orderDetail, order],
  );

  const busyPasteModel = useBusyPasteModel({
    orderId: order.id,
    items: orderDetail.items,
    lineEdits: busyPaste?.lineEdits ?? {},
    flags: busyPaste?.flags ?? {},
    enabled: Boolean(busyPaste),
    finishLoading: busyPaste?.finishLoading,
  });

  const skipWarehousePick =
    stage === 'busy_entry' && busyPasteModel.billableCount === 0 && busyPasteModel.skipCount > 0;

  const editCount = billSheet.unresolvedFlagged.length;

  const flagSummary = useMemo(() => {
    const counts = summarizeDeskFlags(
      billSheet.flaggedItems.map((i) => i.flag_reason),
    );
    return formatDeskFlagSummarySubtitle(counts) || null;
  }, [billSheet.flaggedItems]);

  const allLinesRemoved =
    stage === 'picking' &&
    billSheet.sortedLines.length > 0 &&
    billSheet.visibleItems.length === 0;

  const busyProgressForContext = busyPaste
    ? { entered: busyPasteModel.enteredCount, total: busyPasteModel.billableCount }
    : undefined;

  const pickProgressForStage = useMemo(() => {
    if (stage !== 'picking') return undefined;
    return computePickLineProgress(
      orderDetail.items.map((item) => ({
        state: item.state,
        qty_requested: item.qty_requested,
        qty_shippable: item.qty_shippable,
        qty_po: item.qty_po,
        qty_approved: item.qty_approved,
        split_from_id: item.split_from_id,
      })),
    );
  }, [stage, orderDetail.items]);

  const pickingFlagSummary = useMemo(() => {
    if (stage !== 'picking' || pickProgressForStage?.flagged === 0) return null;
    const flagged = orderDetail.items.filter((i) => i.state === 'flagged');
    const counts = summarizeDeskFlags(flagged.map((i) => i.flag_reason));
    return formatDeskFlagSummarySubtitle(counts) || `${pickProgressForStage?.flagged} flagged`;
  }, [stage, orderDetail.items, pickProgressForStage?.flagged]);

  const pickingMonitor = useMemo(() => {
    if (stage !== 'picking') return null;
    return derivePickingMonitorPresentation({
      deskStatus: order.deskStatus,
      pickingClaimStale: order.pickingClaimStale,
      pickerName: orderDetail.picker_name,
      workflowStatus: orderDetail.workflow_status,
      progress: pickProgressForStage,
    });
  }, [stage, order, orderDetail, pickProgressForStage]);

  const isReviewStage = stage === 'resolve_flags' || stage === 'review_finalise';
  const showReviewDock = isReviewStage || stage === 'done';
  const handoffEnabled = stage === 'review_finalise' || stage === 'done';
  const { data: handoffSummary } = useOrderHandoff(order.id, handoffEnabled, {
    picker_name: orderDetail.picker_name,
    reviewer_name: orderDetail.reviewer_name,
    fulfillment_path: orderDetail.fulfillment_path ?? order.fulfillment_path,
    created_at: orderDetail.created_at,
    completed_at: orderDetail.completed_at,
  });
  const reviewWorkMetrics = useMemo(
    () => (showReviewDock ? deriveReviewWorkMetrics(billSheet) : null),
    [showReviewDock, billSheet],
  );

  const copyForBusy = useCallback(() => {
    const { visibleItems, edits } = billSheet;
    const billable = visibleItems.filter((item) => {
      const edit = edits[item.id];
      if (edit?.removed) return false;
      if (item.state === 'flagged' && edit?.resolution == null) return false;
      return true;
    });
    copy(buildBusyPasteText(billable, { lineEdits: edits }), 'busy-final');
  }, [billSheet, copy]);

  const copyJustCopied = copiedId === 'busy-final';
  const [hasCopiedForBusy, setHasCopiedForBusy] = useState(false);
  const handleCopyForBusy = useCallback(() => {
    copyForBusy();
    setHasCopiedForBusy(true);
  }, [copyForBusy]);

  const unresolvedReviewCount = billSheet.unresolvedFlagged.length;
  const resolveBlocked = billSheet.resolveBlocked;
  const finaliseBlocked =
    resolveBlocked || unresolvedReviewCount > 0 || !billSheet.allFlagsResolved;

  return (
    <div className="relative flex flex-col min-h-0 flex-1">
      {resolveBlocked && billSheet.resolveBlockedBy ? (
        <div className="shrink-0 mx-3 mt-2 rounded-lg border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2">
          <p className="font-ds-caption-size font-semibold text-[var(--content-warning-on-light)]">
            Being finalised by {billSheet.resolveBlockedBy}
          </p>
          <p className="font-ds-micro text-[var(--content-warning-on-light)] mt-0.5 opacity-90">
            Wait or take over from the queue if their session is stale.
          </p>
        </div>
      ) : null}
      <BillingOrderChrome
        stage={stage}
        embedded={embedded}
        editCount={editCount}
        openFlagCount={order.pickerFlags.length}
        allLinesRemoved={allLinesRemoved}
        skipWarehousePick={skipWarehousePick}
        pickProgress={pickProgressForStage}
        showNavBar={(deskEmbedded || (!embedded && !!onClose)) && Boolean(onClose)}
        onBack={onClose}
        onReject={canReject ? () => setShowReject(true) : undefined}
        rejectDisabled={rejectMutation.isPending}
        billHeader={
          !embedded || deskEmbedded ? (
            <BillingBillHeader
              customerName={orderDetail.customer_name}
              customerCity={orderDetail.customer_city}
              customerAddress={orderDetail.customer_address}
              orderId={orderDetail.order_number}
              createdAt={orderDetail.created_at}
              priority={order.priority}
              transportName={orderDetail.transport_name}
            />
          ) : undefined
        }
        handoffSummary={handoffSummary ?? null}
        context={{
          salesperson: orderDetail.salesperson_name,
          createdAt: orderDetail.created_at,
          transportName: orderDetail.transport_name,
          pickerName: orderDetail.picker_name,
          reviewerName: orderDetail.reviewer_name,
          busyProgress: busyProgressForContext,
          pickProgress: pickProgressForStage,
          lineCount: orderDetail.items.length,
          pendingCount: busyPasteModel.skipCount > 0 ? busyPasteModel.skipCount : undefined,
          flagSummary: stage === 'picking' ? pickingFlagSummary : flagSummary,
          pickingNotStarted: pickingMonitor?.contextNotStarted ?? false,
          ewayNeeded: stage === 'review_finalise' && Boolean(orderDetail.transport_name),
          completedAt: orderDetail.completed_at,
          onPickerClick:
            stage === 'picking' || stage === 'assign_picker'
              ? () => setShowAssign(true)
              : undefined,
        }}
        summaryStats={
          /* Totals live in BillingWorkDock for verify/finalise — avoid duplicate summary bar */
          stage === 'done'
            ? [
                {
                  label: 'Billable total',
                  value: formatCurrencyRaw(billSheet.total),
                  tone: 'default' as const,
                },
              ]
            : undefined
        }
        actions={
          stage === 'busy_entry' && busyPaste ? (
            <BillingBusyDock
              billableCount={busyPasteModel.billableCount}
              qtyTotal={busyPasteModel.billableQtyTotal}
              skipCount={busyPasteModel.skipCount}
              specialRateCount={busyPasteModel.specialRateCount}
              focCount={busyPasteModel.focCount}
              pendingCount={busyPasteModel.pendingCount}
              finishAction={busyPasteModel.finishAction}
              onCopy={busyPasteModel.copyBillable}
              copyJustCopied={busyPasteModel.copyJustCopied}
              hasCopiedOnce={busyPasteModel.hasCopiedOnce}
              onFinish={busyPaste.onFinish}
              onSpecialRateClick={() =>
                busyPasteModel.scrollToLine(busyPasteModel.firstSpecialRateLineId)
              }
              onFocClick={() => busyPasteModel.scrollToLine(busyPasteModel.firstFocLineId)}
              onPendingClick={() =>
                busyPasteModel.scrollToLine(busyPasteModel.firstPendingLineId)
              }
              finishLoading={busyPaste.finishLoading}
            />
          ) : showReviewDock && reviewWorkMetrics ? (
            <BillingWorkDock
              billableCount={reviewWorkMetrics.billableCount}
              qtyTotal={reviewWorkMetrics.qtyTotal}
              specialRateCount={reviewWorkMetrics.specialRateCount}
              focCount={reviewWorkMetrics.focCount}
              pendingCount={reviewWorkMetrics.pendingCount}
              onCopy={handleCopyForBusy}
              copyJustCopied={copyJustCopied}
              hasCopiedOnce={hasCopiedForBusy}
              {...(isReviewStage
                ? {
                    primaryLabel: 'Ready to finalise',
                    onPrimary: () => billSheet.saveMutation.mutate(),
                    primaryDisabled: finaliseBlocked,
                    primaryLoading: billSheet.saveMutation.isPending,
                    primaryWarning:
                      unresolvedReviewCount > 0
                        ? `Resolve ${unresolvedReviewCount} edit${unresolvedReviewCount === 1 ? '' : 's'} to finalise`
                        : null,
                  }
                : {})}
            />
          ) : undefined
        }
      >
        {stage === 'busy_entry' && busyPaste ? (
          <BusyPasteLineList
            model={busyPasteModel}
            lineEdits={busyPaste.lineEdits}
            flags={busyPaste.flags}
          />
        ) : null}

        {stage === 'picking' && !showAssign ? (
          <PickingBillStage
            order={order}
            orderDetail={orderDetail}
            items={billSheet.sortedLines}
            pendingByItemId={billSheet.pendingByItemId}
          />
        ) : null}

        {isReviewStage && !showAssign ? (
          <PostPickReviewStage billSheet={billSheet} readOnly={resolveBlocked} />
        ) : null}

        {stage === 'done' && !showAssign ? (
          <>
            <PostPickReviewStage billSheet={billSheet} readOnly />
            <CompleteHandoffStage
              variant="bill_save"
              orderNumber={orderDetail.order_number}
              orderName={orderDetail.customer_name}
              salesperson={orderDetail.salesperson_name}
              items={orderDetail.items}
              billSheet={billSheet}
              readOnly
            />
          </>
        ) : null}

        {stage === 'assign_picker' && !showAssign ? (
          <AssignPickerStage
            order={order}
            pickers={pickers}
            pickerColors={pickerColors}
            onClose={onClose}
            onAssigned={() => onClose?.()}
            variant={deskEmbedded ? 'inline' : 'overlay'}
          />
        ) : null}

        {showAssign ? (
          <AssignPickerStage
            order={order}
            pickers={pickers}
            pickerColors={pickerColors}
            onClose={() => setShowAssign(false)}
            onAssigned={() => setShowAssign(false)}
            variant="overlay"
          />
        ) : null}
      </BillingOrderChrome>

      {showReject ? (
        <BillingRejectDialog
          customerName={orderDetail.customer_name}
          rejectKind={rejectKind}
          rejectReason={rejectReason}
          isSubmitting={rejectMutation.isPending}
          onRejectKindChange={setRejectKind}
          onRejectReasonChange={setRejectReason}
          onCancel={() => {
            setShowReject(false);
            setRejectReason('');
            setRejectKind('account_hold');
          }}
          onConfirm={handleRejectConfirm}
        />
      ) : null}
    </div>
  );
}
