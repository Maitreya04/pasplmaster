export type DeskLineFlagKind = 'oos' | 'price' | 'audit' | 'unknown';

export type DeskFlagAccent = 'red' | 'blue' | 'amber';

const OOS_REASONS = new Set(['Out of Stock', 'Out of Stock (Billing)']);

export function deskLineFlagKind(flagReason: string | null | undefined): DeskLineFlagKind {
  if (!flagReason) return 'unknown';
  if (OOS_REASONS.has(flagReason)) return 'oos';
  if (flagReason === 'Price Mismatch') return 'price';
  return 'audit';
}

export function deskLineFlagChipLabel(flagReason: string | null | undefined): string {
  const kind = deskLineFlagKind(flagReason);
  if (kind === 'oos') return 'Out of stock';
  if (kind === 'price') return 'Price mismatch';
  if (kind === 'audit' && flagReason) return flagReason;
  return 'Needs review';
}

export function deskLineFlagAccent(flagReason: string | null | undefined): DeskFlagAccent {
  const kind = deskLineFlagKind(flagReason);
  if (kind === 'oos') return 'red';
  if (kind === 'price') return 'blue';
  return 'amber';
}

/** Maps flag_reason to pending_items.issue_category when billing removes a line. */
export function deskLineIssueCategory(
  flagReason: string | null | undefined,
): string | null {
  const kind = deskLineFlagKind(flagReason);
  if (kind === 'oos') return 'out_of_stock';
  if (kind === 'audit' && flagReason === "Can't Find") return 'cant_find';
  if (kind === 'audit' && flagReason === 'Wrong Part') return 'wrong_part';
  if (kind === 'audit' && flagReason === 'Damaged') return 'damaged';
  if (kind === 'audit' && flagReason === 'Other') return 'other';
  if (kind === 'unknown') return 'unknown';
  return null;
}

export interface DeskFlagSummaryCounts {
  oos: number;
  price: number;
  audit: number;
  unknown: number;
  total: number;
}

export function summarizeDeskFlags(
  flagReasons: Array<string | null | undefined>,
): DeskFlagSummaryCounts {
  const counts: DeskFlagSummaryCounts = {
    oos: 0,
    price: 0,
    audit: 0,
    unknown: 0,
    total: flagReasons.length,
  };
  for (const reason of flagReasons) {
    const kind = deskLineFlagKind(reason);
    counts[kind] += 1;
  }
  return counts;
}

export function formatDeskFlagSummarySubtitle(counts: DeskFlagSummaryCounts): string {
  const parts: string[] = [];
  if (counts.oos > 0) {
    parts.push(`${counts.oos} out of stock`);
  }
  if (counts.price > 0) {
    parts.push(`${counts.price} price mismatch`);
  }
  if (counts.audit > 0) {
    parts.push(`${counts.audit} other issue${counts.audit === 1 ? '' : 's'}`);
  }
  if (counts.unknown > 0) {
    parts.push(`${counts.unknown} needs review`);
  }
  return parts.join(' · ');
}

/** Order-level strip label (single dominant type or generic). */
export function deskOrderFlagTypeLabel(
  flagReasons: Array<string | null | undefined>,
): { label: string; tone: DeskFlagAccent } {
  const counts = summarizeDeskFlags(flagReasons);
  if (counts.total === 0) {
    return { label: 'Needs review', tone: 'amber' };
  }
  if (counts.oos > 0 && counts.price === 0 && counts.audit === 0 && counts.unknown === 0) {
    return { label: 'Out of stock', tone: 'red' };
  }
  if (counts.price > 0 && counts.oos === 0 && counts.audit === 0 && counts.unknown === 0) {
    return { label: 'Price query', tone: 'blue' };
  }
  if (counts.total === 1 && flagReasons[0]) {
    return {
      label: deskLineFlagChipLabel(flagReasons[0]),
      tone: deskLineFlagAccent(flagReasons[0]),
    };
  }
  return { label: `${counts.total} items need review`, tone: 'amber' };
}
