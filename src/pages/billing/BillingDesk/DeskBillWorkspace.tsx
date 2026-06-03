import { X } from '@phosphor-icons/react';
import { useOrderDetail } from '../../../hooks/useOrderDetail';
import { useBillSheetEdits } from '../../../hooks/useBillSheetEdits';
import { BillingOrderStageBody } from '../../../components/billing/BillingOrderStageBody';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import type { OrderWithItems } from '../../../types';
import { deskType } from './deskTypography';

interface DeskBillWorkspaceProps {
  order: DeskOrderRow;
  flaggedMode: boolean;
  onClearSelection: () => void;
}

export function DeskBillWorkspace({
  order,
  flaggedMode,
  onClearSelection,
}: DeskBillWorkspaceProps): React.JSX.Element {
  const { data: orderDetail, isLoading } = useOrderDetail(order.id);

  if (isLoading || !orderDetail) {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-[var(--bg-secondary)] animate-pulse">
        <div className="h-12 shrink-0 border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)]" />
        <div className="flex-1 m-3 rounded-lg bg-[var(--bg-primary)]" />
      </div>
    );
  }

  return (
    <DeskBillWorkspaceShell
      order={order}
      orderDetail={orderDetail}
      flaggedMode={flaggedMode}
      onClearSelection={onClearSelection}
    />
  );
}

function DeskBillWorkspaceShell({
  order,
  orderDetail,
  flaggedMode,
  onClearSelection,
}: {
  order: DeskOrderRow;
  orderDetail: OrderWithItems;
  flaggedMode: boolean;
  onClearSelection: () => void;
}): React.JSX.Element {
  const billSheet = useBillSheetEdits({
    orderDetail,
    flaggedMode,
    orderIdForClaim: order.id,
    onSaved: onClearSelection,
    onNotified: () => {
      window.setTimeout(onClearSelection, 1600);
    },
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[var(--bg-secondary)]">
      <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)]">
        <div className="flex-1 min-w-0">
          <p className={`${deskType.panelTitle} truncate`}>{order.order_number}</p>
          <p className={`${deskType.panelSub} truncate`}>{order.customer_name}</p>
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          className="shrink-0 p-1.5 rounded-md text-[var(--content-quaternary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--content-primary)]"
          aria-label="Close order and return to live queue"
        >
          <X size={16} weight="bold" />
        </button>
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        <BillingOrderStageBody
          key={order.id}
          order={order}
          orderDetail={orderDetail}
          billSheet={billSheet}
          flaggedMode={flaggedMode}
          embedded
          deskEmbedded
          busyPaste={billSheet.busyPaste}
          onClose={onClearSelection}
        />
      </div>
    </div>
  );
}
