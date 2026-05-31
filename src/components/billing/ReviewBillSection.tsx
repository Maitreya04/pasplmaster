import { BillSheetView } from './BillSheetView';
import { ReviewBillTable } from './ReviewBillTable';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';
import type { OrderWithItems } from '../../types';

export interface ReviewBillSectionProps {
  order: OrderWithItems;
  billSheet: BillSheetEdits;
}

export function ReviewBillSection({
  order,
  billSheet,
}: ReviewBillSectionProps): React.JSX.Element {
  const isPostPick = order.workflow_status !== 'submitted';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--content-primary)]">
            {isPostPick ? 'Bill in Busy' : 'Bill lines'}
          </h2>
          {isPostPick ? (
            <p className="mt-1 text-sm font-medium text-[var(--content-secondary)]">
              Status tags show what each row means · green group = copy into Busy
            </p>
          ) : null}
        </div>
        <a
          href={`/billing/desk?orderId=${order.id}`}
          className="text-sm font-semibold text-[var(--content-accent)] hover:underline"
        >
          Open in Desk
        </a>
      </div>
      {isPostPick ? (
        <ReviewBillTable billSheet={billSheet} />
      ) : (
        <BillSheetView
          orderDetail={order}
          billSheet={billSheet}
          variant="page"
          mode="submitted"
          showFooter={false}
          flaggedMode={order.workflow_status === 'flagged'}
        />
      )}
    </div>
  );
}
