import { FileText, Flag, X } from '@phosphor-icons/react';
import { useOrderDetail } from '../../../hooks/useOrderDetail';
import { useBillSheetEdits } from '../../../hooks/useBillSheetEdits';
import { BillSheetView } from '../../../components/billing/BillSheetView';
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
    onNotified: () => {
      window.setTimeout(() => onClose(), 1600);
    },
  });

  const flagSummary = summarizeDeskFlags(
    billSheet.flaggedItems.map((i) => i.flag_reason),
  );

  const resolvingFlags = billSheet.resolvingFlags;
  const headerTitle = resolvingFlags
    ? flagSummary.total === 1
      ? '1 item needs review'
      : `${flagSummary.total} items need review`
    : order.order_number;

  const headerSubtitle = resolvingFlags
    ? formatDeskFlagSummarySubtitle(flagSummary) || 'Resolve each flagged line'
    : 'Edit MRP · Save & Bill · Notify picker';

  return (
    <div
      className="w-full max-w-[540px] max-h-[628px] flex flex-col rounded-xl bg-[var(--bg-secondary)] overflow-hidden shadow-lg"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="desk-overlay-title"
    >
      <header
        className={`shrink-0 flex items-start gap-2.5 px-4 py-3 ${
          flaggedMode ? 'bg-[var(--bg-warning-subtle)]' : 'bg-[var(--bg-tertiary)]'
        }`}
      >
        {flaggedMode ? (
          <Flag size={18} weight="fill" className="text-[var(--content-warning-on-light)] shrink-0 mt-0.5" />
        ) : (
          <FileText size={18} className="text-[var(--content-quaternary)] shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <h2
            id="desk-overlay-title"
            className={`text-[13px] font-medium ${
              flaggedMode ? 'text-[var(--content-warning)]' : 'text-[var(--content-primary)]'
            }`}
          >
            {headerTitle}
          </h2>
          <p
            className={`text-[11px] mt-0.5 ${
              flaggedMode ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-quaternary)]'
            }`}
          >
            {headerSubtitle}
          </p>
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

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <BillSheetView
          orderDetail={orderDetail}
          billSheet={billSheet}
          variant="overlay"
          mode={orderDetail.workflow_status === 'submitted' ? 'submitted' : 'post_pick'}
          flaggedMode={flaggedMode}
          showFooter
        />
      </div>
    </div>
  );
}
