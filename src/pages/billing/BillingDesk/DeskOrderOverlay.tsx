import { Flag, X } from '@phosphor-icons/react';
import { useOrderDetail } from '../../../hooks/useOrderDetail';
import { useBillSheetEdits } from '../../../hooks/useBillSheetEdits';
import { BillingOrderStageBody } from '../../../components/billing/BillingOrderStageBody';
import {
  deriveBillingOperatorStage,
  billingStageBarIndex,
} from '../../../lib/billing/deriveBillingOperatorStage';
import {
  formatDeskFlagSummarySubtitle,
  summarizeDeskFlags,
} from '../../../lib/billing/deskLineFlagKind';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

interface DeskOrderOverlayProps {
  order: DeskOrderRow;
  flaggedMode: boolean;
  onClose: () => void;
}

export function DeskOrderOverlay({
  order,
  flaggedMode,
  onClose,
}: DeskOrderOverlayProps): React.JSX.Element {
  const { data: orderDetail, isLoading } = useOrderDetail(order.id);

  return (
    <div
      className="absolute inset-0 z-10 flex items-start justify-center p-4 bg-[rgba(0,0,0,0.60)]"
      onClick={onClose}
      role="presentation"
    >
      {isLoading || !orderDetail ? (
        <div
          className="w-full max-w-[540px] h-48 rounded-xl bg-[var(--bg-secondary)] animate-pulse"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <DeskOrderOverlayShell
          key={order.id}
          order={order}
          orderDetail={orderDetail}
          flaggedMode={flaggedMode}
          onClose={onClose}
        />
      )}
    </div>
  );
}

interface DeskOrderOverlayShellProps {
  order: DeskOrderRow;
  orderDetail: NonNullable<ReturnType<typeof useOrderDetail>['data']>;
  flaggedMode: boolean;
  onClose: () => void;
}

function DeskOrderOverlayShell({
  order,
  orderDetail,
  flaggedMode,
  onClose,
}: DeskOrderOverlayShellProps): React.JSX.Element {
  const billSheet = useBillSheetEdits({
    orderDetail,
    flaggedMode,
    orderIdForClaim: order.id,
    onSaved: () => {
      onClose();
    },
    onNotified: () => {
      window.setTimeout(() => onClose(), 1600);
    },
  });

  const flagSummary = summarizeDeskFlags(
    billSheet.flaggedItems.map((i) => i.flag_reason),
  );

  const stage = deriveBillingOperatorStage({
    workflow_status: orderDetail.workflow_status,
    picker_name: orderDetail.picker_name,
    reviewer_name: orderDetail.reviewer_name,
    fulfillment_path: orderDetail.fulfillment_path ?? order.fulfillment_path,
    stock_location_code: orderDetail.stock_location_code ?? order.stock_location_code,
    deskStatus: order.deskStatus,
    openPickerFlagCount: order.pickerFlags.length,
  });

  const wide =
    billingStageBarIndex(stage) >= 3 ||
    stage === 'picking' ||
    stage === 'review_finalise' ||
    stage === 'resolve_flags' ||
    stage === 'done';

  const resolvingFlags = billSheet.resolvingFlags;
  const headerTitle = resolvingFlags
    ? flagSummary.total === 1
      ? '1 item needs review'
      : `${flagSummary.total} items need review`
    : order.order_number;

  const headerSubtitle = resolvingFlags
    ? formatDeskFlagSummarySubtitle(flagSummary) || 'Resolve each flagged line'
    : orderDetail.customer_name;

  return (
    <div
      className={`w-full ${wide ? 'max-w-4xl' : 'max-w-[540px]'} max-h-[min(90vh,720px)] flex flex-col rounded-xl bg-[var(--bg-secondary)] overflow-hidden shadow-lg`}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="desk-overlay-title"
    >
      <header
        className={`shrink-0 flex items-start gap-2.5 px-4 py-3 border-b border-[var(--border-faint)] ${
          flaggedMode ? 'bg-[var(--bg-warning-subtle)]' : 'bg-[var(--bg-tertiary)]'
        }`}
      >
        {flaggedMode ? (
          <Flag size={18} weight="fill" className="text-[var(--content-warning-on-light)] shrink-0 mt-0.5" />
        ) : null}
        <div className="flex-1 min-w-0">
          <h2
            id="desk-overlay-title"
            className={`font-ds-prose font-semibold ${
              flaggedMode ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-primary)]'
            }`}
          >
            {headerTitle}
          </h2>
          <p className="font-ds-micro mt-0.5 text-[var(--content-quaternary)]">{headerSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-[var(--content-quaternary)] hover:bg-[var(--bg-secondary)]"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        <BillingOrderStageBody
          order={order}
          orderDetail={orderDetail}
          billSheet={billSheet}
          flaggedMode={flaggedMode}
          busyPaste={billSheet.busyPaste}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
