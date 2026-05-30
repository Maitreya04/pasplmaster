import { deskLineFlagChipLabel, deskLineFlagKind } from './deskLineFlagKind';
import { resolvedLabelPriceForBilling } from './labelMrpFlag';
import {
  BILLING_LABEL_CHIP,
  BILLING_PRICE_SUMMARY,
  formatRoundedRs,
} from './mrpWorkflowCopy';
import { orderItemConfirmedMrp } from './orderItemSplitGroups';
import type { OrderItem } from '../../types';
import type { OverlayLineEdit, OverlayLineResolution } from '../../pages/billing/BillingDesk/types';

export type BillLineChangeSegment =
  | { kind: 'flag'; label: string }
  | { kind: 'text'; text: string }
  | { kind: 'resolved'; label: string };

function resolutionLabel(resolution: OverlayLineResolution | null): string | null {
  if (resolution === 'accept_price') return 'accepted';
  if (resolution === 'keep_quoted') return 'kept';
  if (resolution === 'manual_override') return 'edited';
  if (resolution === 'removed') return 'removed';
  return null;
}

/** Flag chip + price deltas + picker notes for the bill item column. */
export function billLineChangeSegments(
  item: OrderItem,
  edit?: OverlayLineEdit,
): BillLineChangeSegment[] {
  const segments: BillLineChangeSegment[] = [];
  const labelMrp = orderItemConfirmedMrp(item);
  const quoted = item.price_quoted ?? item.price_system ?? 0;
  const labelPrice = resolvedLabelPriceForBilling(item, labelMrp);
  const flagKind = deskLineFlagKind(item.flag_reason);
  const resolved = edit?.resolution != null;
  const resolutionSuffix = resolutionLabel(edit?.resolution ?? null);

  if (item.state === 'flagged' && item.flag_reason) {
    const chip = deskLineFlagChipLabel(item.flag_reason);
    segments.push({
      kind: resolved ? 'resolved' : 'flag',
      label: resolutionSuffix ? `${chip} · ${resolutionSuffix}` : chip,
    });
  }

  if (flagKind === 'price' && labelPrice != null && !edit?.removed) {
    segments.push({ kind: 'text', text: BILLING_PRICE_SUMMARY(labelPrice, quoted) });
  } else if (labelMrp != null && flagKind !== 'price' && !edit?.removed) {
    segments.push({ kind: 'text', text: BILLING_LABEL_CHIP(labelMrp) });
  }

  if (item.split_from_id != null && labelMrp != null && !edit?.removed) {
    segments.push({
      kind: 'text',
      text: `↳ Batch · Label MRP ${formatRoundedRs(labelMrp)}`,
    });
  }

  if (item.flag_notes?.trim()) {
    segments.push({ kind: 'text', text: item.flag_notes.trim() });
  }

  return segments;
}
