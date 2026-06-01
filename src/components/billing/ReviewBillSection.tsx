import { deriveBillingOperatorStage } from '../../lib/billing/deriveBillingOperatorStage';
import {
  deriveDeskOrderStatus,
  type DeskOrderRow,
} from '../../hooks/useBillingDeskOrders';
import { BillSheetView } from './BillSheetView';
import { BillingBillHeader } from './chrome/BillingBillHeader';
import { BillingOrderChrome } from './chrome/BillingOrderChrome';
import { BillingOrderStageBody } from './BillingOrderStageBody';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';
import type { OrderWithItems } from '../../types';

export interface ReviewBillSectionProps {
  order: OrderWithItems;
  billSheet: BillSheetEdits;
  deskOrder?: DeskOrderRow;
}

function reviewPageDeskRow(order: OrderWithItems, deskOrder?: DeskOrderRow): DeskOrderRow {
  if (deskOrder) return deskOrder;
  const claimStub = {
    ...order,
    claim_info: null,
    sales_edit_claim_info: null,
    is_mine: false,
    special_rate_line_count: 0,
    special_rate_qty: 0,
  };
  return {
    ...claimStub,
    deskStatus: deriveDeskOrderStatus(claimStub, false),
    pickingClaimStale: false,
    pickerFlags: [],
  };
}

export function ReviewBillSection({
  order,
  billSheet,
  deskOrder,
}: ReviewBillSectionProps): React.JSX.Element {
  const stage = deriveBillingOperatorStage({
    workflow_status: order.workflow_status,
    picker_name: order.picker_name,
    reviewer_name: order.reviewer_name,
    fulfillment_path: order.fulfillment_path ?? deskOrder?.fulfillment_path,
    stock_location_code: order.stock_location_code ?? deskOrder?.stock_location_code,
    deskStatus: deskOrder?.deskStatus,
    openPickerFlagCount: deskOrder?.pickerFlags.length ?? 0,
  });

  const deskRow = reviewPageDeskRow(order, deskOrder);

  const isPrePick = stage === 'busy_entry';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--content-primary)]">
            {isPrePick ? 'Bill lines' : 'Bill in Busy'}
          </h2>
          {!isPrePick ? (
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

      {isPrePick ? (
        <BillingOrderChrome
          stage={stage}
          suppressContextBar
          billHeader={
            <BillingBillHeader
              customerName={order.customer_name}
              orderId={order.order_number}
              createdAt={order.created_at}
              priority={order.priority}
              transportName={order.transport_name}
            />
          }
          context={{
            salesperson: order.salesperson_name,
            createdAt: order.created_at,
            pickerName: order.picker_name,
          }}
        >
          <BillSheetView
            orderDetail={order}
            billSheet={billSheet}
            variant="page"
            mode="submitted"
            showFooter
            hideOrderSummary
            flaggedMode={order.workflow_status === 'flagged'}
          />
        </BillingOrderChrome>
      ) : (
        <BillingOrderStageBody
          order={deskRow}
          orderDetail={order}
          billSheet={billSheet}
          flaggedMode={order.workflow_status === 'flagged'}
        />
      )}
    </div>
  );
}
