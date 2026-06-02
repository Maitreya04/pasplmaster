import { useMemo, useState } from 'react';
import { deriveBillingOperatorStage } from '../../lib/billing/deriveBillingOperatorStage';
import {
  formatDeskFlagSummarySubtitle,
  summarizeDeskFlags,
} from '../../lib/billing/deskLineFlagKind';
import { busyPasteProgress, BusyPasteStage } from './stages/BusyPasteStage';
import { AssignPickerStage } from './stages/AssignPickerStage';
import { PostPickReviewStage } from './stages/PostPickReviewStage';
import { CompleteHandoffStage } from './stages/CompleteHandoffStage';
import { BillingOrderChrome } from './chrome/BillingOrderChrome';
import { BillingBillHeader } from './chrome/BillingBillHeader';
import { usePickerLoad } from '../../hooks/usePickerLoad';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';
import type { DeskOrderRow } from '../../hooks/useBillingDeskOrders';
import type { OrderWithItems } from '../../types';
import {
  countBusyBillableLines,
  countFullyPendingBusyLines,
} from '../../lib/billing/busyLineSplit';
import type { BillingLineEdit, ItemFlag } from '../../hooks/useBillingFlow';
import { formatCurrencyRaw } from '../../utils/formatters';

interface BillingOrderStageBodyProps {
  order: DeskOrderRow;
  orderDetail: OrderWithItems;
  billSheet: BillSheetEdits;
  flaggedMode: boolean;
  embedded?: boolean;
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
  flaggedMode,
  embedded = false,
  onClose,
  busyPaste,
}: BillingOrderStageBodyProps): React.JSX.Element {
  const { pickers, colors: pickerColors } = usePickerLoad();
  const [showAssign, setShowAssign] = useState(false);

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

  const billableCount = busyPaste
    ? countBusyBillableLines(orderDetail.items, busyPaste.flags, busyPaste.lineEdits)
    : 0;

  const skipCount = busyPaste
    ? countFullyPendingBusyLines(orderDetail.items, busyPaste.flags, busyPaste.lineEdits)
    : 0;

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
    ? { entered: busyPasteProgress(order.id, billableCount).entered, total: billableCount }
    : undefined;

  return (
    <div className="relative flex flex-col min-h-0 flex-1">
      <BillingOrderChrome
        stage={stage}
        embedded={embedded}
        editCount={editCount}
        openFlagCount={order.pickerFlags.length}
        allLinesRemoved={allLinesRemoved}
        showNavBar={!embedded && !!onClose}
        onBack={onClose}
        billHeader={
          embedded ? undefined : (
            <BillingBillHeader
              customerName={orderDetail.customer_name}
              orderId={orderDetail.order_number}
              createdAt={orderDetail.created_at}
              priority={order.priority}
              transportName={orderDetail.transport_name}
            />
          )
        }
        context={{
          salesperson: orderDetail.salesperson_name,
          createdAt: orderDetail.created_at,
          transportName: orderDetail.transport_name,
          pickerName: orderDetail.picker_name,
          reviewerName: orderDetail.reviewer_name,
          busyProgress: busyProgressForContext,
          lineCount: orderDetail.items.length,
          pendingCount: skipCount > 0 ? skipCount : undefined,
          flagSummary,
          ewayNeeded: stage === 'review_finalise' && Boolean(orderDetail.transport_name),
          completedAt: orderDetail.completed_at,
          onPickerClick: () => setShowAssign(true),
        }}
        summaryStats={
          stage === 'review_finalise' ||
          stage === 'resolve_flags' ||
          stage === 'done'
            ? [
                {
                  label: 'Billable total',
                  value: formatCurrencyRaw(billSheet.total),
                  tone:
                    stage !== 'done' && editCount > 0
                      ? ('warning' as const)
                      : ('default' as const),
                },
              ]
            : undefined
        }
      >
        {stage === 'busy_entry' && busyPaste ? (
          <BusyPasteStage
            orderId={order.id}
            items={orderDetail.items}
            lineEdits={busyPaste.lineEdits}
            flags={busyPaste.flags}
            onFinish={busyPaste.onFinish}
            finishLoading={busyPaste.finishLoading}
          />
        ) : null}

        {stage === 'picking' && !showAssign ? (
          <div className="p-4 font-ds-caption-size text-[var(--content-secondary)]">
            Pick in progress
            {orderDetail.picker_name ? ` · ${orderDetail.picker_name}` : ''}. Monitor on the
            Picking tab — bill actions unlock when the pick completes.
          </div>
        ) : null}

        {(stage === 'resolve_flags' || stage === 'review_finalise') && !showAssign ? (
          <PostPickReviewStage
            billSheet={billSheet}
            flaggedMode={flaggedMode || stage === 'resolve_flags'}
            onReadyToFinalise={() => billSheet.saveMutation.mutate()}
          />
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

        {(stage === 'assign_picker' || showAssign) ? (
          <AssignPickerStage
            order={order}
            pickers={pickers}
            pickerColors={pickerColors}
            onClose={() => {
              setShowAssign(false);
              onClose?.();
            }}
            onAssigned={() => {
              setShowAssign(false);
              onClose?.();
            }}
            variant="overlay"
          />
        ) : null}
      </BillingOrderChrome>
    </div>
  );
}
