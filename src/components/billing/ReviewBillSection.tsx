import { useEffect, useRef } from 'react';
import { BillSheetView } from './BillSheetView';
import { useBillSheetEdits, type BillSheetEdits } from '../../hooks/useBillSheetEdits';
import type { FulfillmentPath, OrderWithItems } from '../../types';

export interface ReviewBillSectionProps {
  order: OrderWithItems;
  fulfillmentPath: FulfillmentPath;
  onReady: (billSheet: BillSheetEdits) => void;
  onSaved?: () => void;
}

export function ReviewBillSection({
  order,
  fulfillmentPath,
  onReady,
  onSaved,
}: ReviewBillSectionProps): React.JSX.Element {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const billSheet = useBillSheetEdits({
    orderDetail: order,
    flaggedMode: order.workflow_status === 'flagged',
    fulfillmentPath,
    orderIdForClaim: order.id,
    onSaved,
  });

  useEffect(() => {
    onReadyRef.current(billSheet);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--content-primary)]">
          {order.workflow_status === 'submitted' ? 'Bill lines' : 'Warehouse bill lines'}
        </h2>
        <a
          href={`/billing/desk?orderId=${order.id}`}
          className="text-xs font-medium text-[var(--content-accent)] hover:underline"
        >
          Open in Desk
        </a>
      </div>
      <BillSheetView
        orderDetail={order}
        billSheet={billSheet}
        variant="page"
        mode={order.workflow_status === 'submitted' ? 'submitted' : 'post_pick'}
        showFooter={false}
        flaggedMode={order.workflow_status === 'flagged'}
      />
    </div>
  );
}
