import { deskLineFlagChipLabel, deskLineFlagKind } from './deskLineFlagKind';
import { resolvedLabelPriceForBilling } from './labelMrpFlag';
import { formatRoundedRs } from './mrpWorkflowCopy';
import {
  pickMrpQtyBreakdownForItem,
  readPickMrpSnapshot,
} from './pickMrpBillingContext';
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
  allItems?: OrderItem[],
): BillLineChangeSegment[] {
  const segments: BillLineChangeSegment[] = [];
  const snapshot = readPickMrpSnapshot(item);
  const labelMrp = snapshot.labelMrp ?? orderItemConfirmedMrp(item);
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

  if (labelMrp != null && !edit?.removed) {
    const bill = snapshot.billingRateAtPick ?? quoted;
    segments.push({
      kind: 'text',
      text: `Label ${formatRoundedRs(labelMrp)} · bill ${formatRoundedRs(bill)}`,
    });
    if (
      snapshot.suggestedMrpAtPick != null &&
      snapshot.suggestedMrpAtPick !== labelMrp
    ) {
      segments.push({
        kind: 'text',
        text: `Stock ${formatRoundedRs(snapshot.suggestedMrpAtPick)} at pick`,
      });
    }
    if (allItems?.length) {
      const mix = pickMrpQtyBreakdownForItem(item, allItems);
      if (mix) segments.push({ kind: 'text', text: `Picker · ${mix}` });
    }
  }

  if (item.scan_result?.isOverTarget) {
    const original = item.scan_result.originalTargetQty ?? item.scan_result.progress?.targetQty;
    const picked = item.scan_result.progress?.pickedQty ?? item.qty_requested;
    const extra =
      item.scan_result.overTargetQty ??
      (original != null ? Math.max(0, picked - original) : null);
    const note = item.scan_result.pickerNote?.trim();
    segments.push({
      kind: 'text',
      text: `Overpicked ${picked}${original != null ? ` vs ${original} ordered` : ''}${
        extra != null && extra > 0 ? ` · +${extra}` : ''
      }${note ? ` · ${note}` : ''}`,
    });
  }

  if (item.scan_result?.isShortPick) {
    const original = item.scan_result.originalTargetQty ?? item.scan_result.progress?.targetQty;
    const picked = item.scan_result.progress?.pickedQty ?? item.qty_requested;
    const short = item.scan_result.shortQty;
    const reason = item.scan_result.shortReason?.trim();
    const note = item.scan_result.pickerNote?.trim();
    segments.push({
      kind: 'text',
      text: `Short picked ${picked}${original != null ? ` of ${original}` : ''}${
        short != null && short > 0 ? ` · ${short} short` : ''
      }${reason ? ` · ${reason}` : ''}${note ? ` · ${note}` : ''}`,
    });
  }

  if (flagKind === 'price' && labelPrice != null && !edit?.removed) {
    segments.push({
      kind: 'text',
      text: `Bill at label ${formatRoundedRs(labelPrice)} · quoted ${formatRoundedRs(quoted)}`,
    });
  }

  if (item.flag_notes?.trim()) {
    segments.push({ kind: 'text', text: item.flag_notes.trim() });
  }

  return segments;
}
