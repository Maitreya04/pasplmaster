import {
  BILLING_PICK_MRP_BILL_RATE,
  BILLING_PICK_MRP_LABEL,
  BILLING_PICK_MRP_MIX,
  BILLING_PICK_MRP_PICKER_FLAG,
  BILLING_PICK_MRP_STOCK_SUGGESTED,
  formatRoundedRs,
} from '../../lib/billing/mrpWorkflowCopy';
import {
  labelDiffersFromBillingRate,
  type PickMrpSnapshot,
} from '../../lib/billing/pickMrpBillingContext';

export interface PickMrpBillingDetailProps {
  snapshot: PickMrpSnapshot;
  qtyBreakdown?: string | null;
  compact?: boolean;
}

/**
 * Billing-facing strip: picker label MRP (source of truth) vs bill rate vs stock at pick.
 */
export function PickMrpBillingDetail({
  snapshot,
  qtyBreakdown,
  compact = false,
}: PickMrpBillingDetailProps): React.JSX.Element | null {
  const { labelMrp, billingRateAtPick, suggestedMrpAtPick, mrpFlagged } = snapshot;
  if (labelMrp == null) return null;

  const billDiffers = labelDiffersFromBillingRate(snapshot);
  const textSize = compact ? 'text-[9px]' : 'text-[10px]';

  return (
    <div className={`mt-1 space-y-0.5 ${textSize}`}>
      <p className="font-semibold leading-snug">
        <span className="text-[var(--content-primary)]">
          {BILLING_PICK_MRP_LABEL} {formatRoundedRs(labelMrp)}
        </span>
        {billingRateAtPick != null && billingRateAtPick > 0 ? (
          <span
            className={
              billDiffers
                ? ' text-[var(--content-warning-on-light)]'
                : ' text-[var(--content-tertiary)]'
            }
          >
            {' '}
            · {BILLING_PICK_MRP_BILL_RATE} {formatRoundedRs(billingRateAtPick)}
          </span>
        ) : null}
      </p>
      {suggestedMrpAtPick != null && suggestedMrpAtPick > 0 ? (
        <p className="text-[var(--content-tertiary)] leading-snug">
          {BILLING_PICK_MRP_STOCK_SUGGESTED} {formatRoundedRs(suggestedMrpAtPick)}
          {mrpFlagged ? (
            <span className="font-semibold text-[var(--content-warning-on-light)]">
              {' '}
              · {BILLING_PICK_MRP_PICKER_FLAG}
            </span>
          ) : null}
        </p>
      ) : mrpFlagged ? (
        <p className="font-semibold text-[var(--content-warning-on-light)] leading-snug">
          {BILLING_PICK_MRP_PICKER_FLAG}
        </p>
      ) : null}
      {qtyBreakdown ? (
        <p className="font-medium text-[var(--content-secondary)] leading-snug">
          {BILLING_PICK_MRP_MIX}: {qtyBreakdown}
        </p>
      ) : null}
    </div>
  );
}
